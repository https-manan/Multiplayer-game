import { Server, Socket } from "socket.io";
import prisma from "./prisma";
import {
  addPlayer,
  clearCallActive,
  computeProximityEvents,
  getPlayer,
  getPlayersInRoom,
  isUsernameTakenInRoom,
  movePlayer,
  removePlayer,
  setCallActive,
  toPublicPlayer,
} from "./roomState";
import { ClientToServerEvents, ServerToClientEvents } from "./types";

const PROXIMITY_START_DISTANCE = Number(process.env.PROXIMITY_START_DISTANCE ?? 90);
const PROXIMITY_END_DISTANCE = Number(process.env.PROXIMITY_END_DISTANCE ?? 130);

const AVATAR_COLORS = ["#4f8fef", "#ef6f4f", "#4fef8f", "#efd54f", "#b04fef", "#4fefe6"];
function colorForIndex(i: number) {
  return AVATAR_COLORS[i % AVATAR_COLORS.length];
}

async function getOrCreateUser(username: string) {
  return prisma.user.upsert({
    where: { username },
    update: {},
    create: { username },
  });
}

async function getOrCreateRoom(roomName: string) {
  return prisma.room.upsert({
    where: { name: roomName },
    update: {},
    create: { name: roomName },
  });
}

export function registerSocketHandlers(
  io: Server<ClientToServerEvents, ServerToClientEvents>
) {
  io.on("connection", (socket: Socket<ClientToServerEvents, ServerToClientEvents>) => {
    socket.on("join", async ({ username, roomName }) => {
      try {
        const cleanUsername = (username || "").trim().slice(0, 24);
        const cleanRoomName = (roomName || "lobby").trim().slice(0, 40) || "lobby";

        if (!cleanUsername) {
          socket.emit("error-message", { message: "Username is required." });
          return;
        }

        if (isUsernameTakenInRoom(cleanRoomName, cleanUsername)) {
          socket.emit("error-message", {
            message: `"${cleanUsername}" is already in room "${cleanRoomName}". Pick another name.`,
          });
          return;
        }

        // Persist the user + room + membership record via Prisma.
        const user = await getOrCreateUser(cleanUsername);
        const room = await getOrCreateRoom(cleanRoomName);
        await prisma.roomMember.upsert({
          where: { userId_roomId: { userId: user.id, roomId: room.id } },
          update: {},
          create: { userId: user.id, roomId: room.id },
        });

        const existingCount = getPlayersInRoom(cleanRoomName).length;

        const player = {
          socketId: socket.id,
          userId: user.id,
          username: cleanUsername,
          roomName: cleanRoomName,
          x: 400 + (Math.random() * 100 - 50),
          y: 300 + (Math.random() * 100 - 50),
          color: colorForIndex(existingCount),
        };

        addPlayer(player);
        socket.join(cleanRoomName);
        socket.data.roomName = cleanRoomName;

        const others = getPlayersInRoom(cleanRoomName)
          .filter((p) => p.socketId !== socket.id)
          .map(toPublicPlayer);

        socket.emit("joined", { self: toPublicPlayer(player), players: others });
        socket.to(cleanRoomName).emit("player-joined", { player: toPublicPlayer(player) });
      } catch (err) {
        console.error("join error", err);
        socket.emit("error-message", { message: "Failed to join room." });
      }
    });

    socket.on("move", ({ x, y }) => {
      const player = getPlayer(socket.id);
      if (!player) return;

      // Clamp to a reasonable room area server-side too, don't trust the client blindly.
      const clampedX = Math.max(20, Math.min(1180, x));
      const clampedY = Math.max(20, Math.min(780, y));

      movePlayer(socket.id, clampedX, clampedY);
      socket.to(player.roomName).emit("player-moved", { id: socket.id, x: clampedX, y: clampedY });

      // Check proximity against everyone else in the room and start/end calls.
      const events = computeProximityEvents(
        player.roomName,
        PROXIMITY_START_DISTANCE,
        PROXIMITY_END_DISTANCE
      );

      for (const evt of events) {
        if (evt.type === "start") {
          setCallActive(evt.a.socketId, evt.b.socketId);
          // Deterministically pick one side as the WebRTC "initiator" (offer creator)
          // to avoid both sides racing to create an offer at once ("glare").
          const initiatorIsA = evt.a.socketId < evt.b.socketId;

          io.to(evt.a.socketId).emit("call-initiate", {
            peerId: evt.b.socketId,
            peerUsername: evt.b.username,
            initiator: initiatorIsA,
          });
          io.to(evt.b.socketId).emit("call-initiate", {
            peerId: evt.a.socketId,
            peerUsername: evt.a.username,
            initiator: !initiatorIsA,
          });

          prisma.room
            .findUnique({ where: { name: player.roomName } })
            .then((room: { id: string } | null) => {
              if (!room) return;
              return prisma.callLog.create({
                data: { roomId: room.id, userAId: evt.a.userId, userBId: evt.b.userId },
              });
            })
            .catch((e: unknown) => console.error("callLog create error", e));
        } else {
          clearCallActive(evt.a.socketId, evt.b.socketId);
          io.to(evt.a.socketId).emit("call-end", { peerId: evt.b.socketId });
          io.to(evt.b.socketId).emit("call-end", { peerId: evt.a.socketId });

          prisma.callLog
            .findFirst({
              where: {
                OR: [
                  { userAId: evt.a.userId, userBId: evt.b.userId },
                  { userAId: evt.b.userId, userBId: evt.a.userId },
                ],
                endedAt: null,
              },
              orderBy: { startedAt: "desc" },
            })
            .then((log: { id: string } | null) => {
              if (!log) return;
              return prisma.callLog.update({ where: { id: log.id }, data: { endedAt: new Date() } });
            })
            .catch((e: unknown) => console.error("callLog update error", e));
        }
      }
    });

    // WebRTC signaling relay: server never inspects offer/answer/ICE payloads,
    // it just forwards them between the two peers involved in a call.
    socket.on("signal", ({ to, signal }) => {
      io.to(to).emit("signal", { from: socket.id, signal });
    });

    socket.on("leave-call", ({ with: otherId }) => {
      clearCallActive(socket.id, otherId);
      io.to(otherId).emit("call-end", { peerId: socket.id });
    });

    socket.on("disconnect", () => {
      const player = getPlayer(socket.id);
      if (!player) return;
      removePlayer(socket.id);
      socket.to(player.roomName).emit("player-left", { id: socket.id });
    });
  });
}
