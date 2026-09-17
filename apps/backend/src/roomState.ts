import { LivePlayer, PublicPlayer } from "./types";

// All live presence data lives in memory, keyed by socket id.
// Rooms are derived by grouping players by roomName.
const players = new Map<string, LivePlayer>();

// Tracks which pairs of socket ids currently have an active call, so we know
// when to fire "call-end" (hysteresis) and don't spam "call-initiate" every tick.
const activeCalls = new Set<string>();

function pairKey(a: string, b: string): string {
  return [a, b].sort().join("::");
}

export function toPublicPlayer(p: LivePlayer): PublicPlayer {
  return { id: p.socketId, userId: p.userId, username: p.username, x: p.x, y: p.y, color: p.color };
}

export function addPlayer(player: LivePlayer) {
  players.set(player.socketId, player);
}

export function removePlayer(socketId: string) {
  players.delete(socketId);
  // clean up any active call pairings involving this socket
  for (const key of Array.from(activeCalls)) {
    if (key.includes(socketId)) activeCalls.delete(key);
  }
}

export function getPlayer(socketId: string): LivePlayer | undefined {
  return players.get(socketId);
}

export function movePlayer(socketId: string, x: number, y: number) {
  const p = players.get(socketId);
  if (p) {
    p.x = x;
    p.y = y;
  }
}

export function getPlayersInRoom(roomName: string): LivePlayer[] {
  return Array.from(players.values()).filter((p) => p.roomName === roomName);
}

export function isUsernameTakenInRoom(roomName: string, username: string): boolean {
  return getPlayersInRoom(roomName).some(
    (p) => p.username.toLowerCase() === username.toLowerCase()
  );
}

function distance(a: LivePlayer, b: LivePlayer): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function isCallActive(a: string, b: string): boolean {
  return activeCalls.has(pairKey(a, b));
}

export function setCallActive(a: string, b: string) {
  activeCalls.add(pairKey(a, b));
}

export function clearCallActive(a: string, b: string) {
  activeCalls.delete(pairKey(a, b));
}

export interface ProximityEvent {
  type: "start" | "end";
  a: LivePlayer;
  b: LivePlayer;
}

// Compares every pair of players in a room against the start/end thresholds
// and returns which pairs should start or end a call right now.
export function computeProximityEvents(
  roomName: string,
  startDistance: number,
  endDistance: number
): ProximityEvent[] {
  const roomPlayers = getPlayersInRoom(roomName);
  const events: ProximityEvent[] = [];

  for (let i = 0; i < roomPlayers.length; i++) {
    for (let j = i + 1; j < roomPlayers.length; j++) {
      const a = roomPlayers[i];
      const b = roomPlayers[j];
      const d = distance(a, b);
      const active = isCallActive(a.socketId, b.socketId);

      if (!active && d <= startDistance) {
        events.push({ type: "start", a, b });
      } else if (active && d >= endDistance) {
        events.push({ type: "end", a, b });
      }
    }
  }

  return events;
}
