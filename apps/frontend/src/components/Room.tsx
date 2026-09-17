import React, { useEffect, useRef, useState, useCallback } from "react";
import { AppSocket } from "../hooks/useSocket";
import { PublicPlayer } from "../types";
import { PeerCall } from "../webrtc/webrtc";

const CANVAS_WIDTH = 1000;
const CANVAS_HEIGHT = 640;
const MOVE_SPEED = 4; // px per animation frame
const AVATAR_RADIUS = 18;
const MOVE_EMIT_INTERVAL_MS = 50;

interface RoomProps {
  socket: AppSocket;
  self: PublicPlayer;
  initialPlayers: PublicPlayer[];
  roomName: string;
}

export default function Room({ socket, self, initialPlayers, roomName }: RoomProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Players other than "self", keyed by socket id.
  const playersRef = useRef<Map<string, PublicPlayer>>(
    new Map(initialPlayers.map((p) => [p.id, p]))
  );
  const [, forceRender] = useState(0);

  const selfPosRef = useRef({ x: self.x, y: self.y });
  const keysDown = useRef<Set<string>>(new Set());

  const localStreamRef = useRef<MediaStream | null>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const peerCallsRef = useRef<Map<string, PeerCall>>(new Map());
  const [remoteStreams, setRemoteStreams] = useState<Map<string, MediaStream>>(new Map());
  const [activePeers, setActivePeers] = useState<Map<string, string>>(new Map()); // peerId -> username
  const [mediaError, setMediaError] = useState<string | null>(null);

  // --- Acquire local camera/mic once, up front, so calls can start instantly ---
  useEffect(() => {
    let cancelled = false;
    navigator.mediaDevices
      .getUserMedia({ video: true, audio: true })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        localStreamRef.current = stream;
        if (localVideoRef.current) localVideoRef.current.srcObject = stream;
      })
      .catch((err) => {
        console.error("getUserMedia failed", err);
        setMediaError("Camera/mic access denied - video calls won't work, but movement still will.");
      });

    return () => {
      cancelled = true;
      localStreamRef.current?.getTracks().forEach((t) => t.stop());
      peerCallsRef.current.forEach((call) => call.close());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- Socket event wiring for presence + signaling ---
  useEffect(() => {
    const onPlayerJoined = ({ player }: { player: PublicPlayer }) => {
      playersRef.current.set(player.id, player);
      forceRender((n) => n + 1);
    };

    const onPlayerMoved = ({ id, x, y }: { id: string; x: number; y: number }) => {
      const p = playersRef.current.get(id);
      if (p) {
        p.x = x;
        p.y = y;
      }
    };

    const onPlayerLeft = ({ id }: { id: string }) => {
      playersRef.current.delete(id);
      const call = peerCallsRef.current.get(id);
      if (call) {
        call.close();
        peerCallsRef.current.delete(id);
      }
      setRemoteStreams((prev) => {
        const next = new Map(prev);
        next.delete(id);
        return next;
      });
      setActivePeers((prev) => {
        const next = new Map(prev);
        next.delete(id);
        return next;
      });
      forceRender((n) => n + 1);
    };

    const onCallInitiate = ({
      peerId,
      peerUsername,
      initiator,
    }: {
      peerId: string;
      peerUsername: string;
      initiator: boolean;
    }) => {
      if (peerCallsRef.current.has(peerId)) return; // already in a call with them
      if (!localStreamRef.current) {
        console.warn("No local media yet, cannot start call with", peerUsername);
        return;
      }

      const call = new PeerCall({
        socket,
        peerId,
        initiator,
        localStream: localStreamRef.current,
        onRemoteStream: (stream) => {
          setRemoteStreams((prev) => new Map(prev).set(peerId, stream));
        },
        onClose: () => {
          peerCallsRef.current.delete(peerId);
          setRemoteStreams((prev) => {
            const next = new Map(prev);
            next.delete(peerId);
            return next;
          });
          setActivePeers((prev) => {
            const next = new Map(prev);
            next.delete(peerId);
            return next;
          });
        },
      });

      peerCallsRef.current.set(peerId, call);
      setActivePeers((prev) => new Map(prev).set(peerId, peerUsername));
    };

    const onCallEnd = ({ peerId }: { peerId: string }) => {
      const call = peerCallsRef.current.get(peerId);
      if (call) {
        call.close();
        peerCallsRef.current.delete(peerId);
      }
      setRemoteStreams((prev) => {
        const next = new Map(prev);
        next.delete(peerId);
        return next;
      });
      setActivePeers((prev) => {
        const next = new Map(prev);
        next.delete(peerId);
        return next;
      });
    };

    const onSignal = ({ from, signal }: { from: string; signal: unknown }) => {
      const call = peerCallsRef.current.get(from);
      if (call) {
        call.handleSignal(signal as any);
      }
    };

    socket.on("player-joined", onPlayerJoined);
    socket.on("player-moved", onPlayerMoved);
    socket.on("player-left", onPlayerLeft);
    socket.on("call-initiate", onCallInitiate);
    socket.on("call-end", onCallEnd);
    socket.on("signal", onSignal);

    return () => {
      socket.off("player-joined", onPlayerJoined);
      socket.off("player-moved", onPlayerMoved);
      socket.off("player-left", onPlayerLeft);
      socket.off("call-initiate", onCallInitiate);
      socket.off("call-end", onCallEnd);
      socket.off("signal", onSignal);
    };
  }, [socket]);

  // --- Keyboard input (WASD / arrow keys) ---
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => keysDown.current.add(e.key.toLowerCase());
    const onKeyUp = (e: KeyboardEvent) => keysDown.current.delete(e.key.toLowerCase());
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, []);

  // --- Movement + render loop ---
  useEffect(() => {
    let rafId: number;
    let lastEmit = 0;

    const tick = (time: number) => {
      const keys = keysDown.current;
      let dx = 0;
      let dy = 0;
      if (keys.has("w") || keys.has("arrowup")) dy -= MOVE_SPEED;
      if (keys.has("s") || keys.has("arrowdown")) dy += MOVE_SPEED;
      if (keys.has("a") || keys.has("arrowleft")) dx -= MOVE_SPEED;
      if (keys.has("d") || keys.has("arrowright")) dx += MOVE_SPEED;

      if (dx !== 0 || dy !== 0) {
        const pos = selfPosRef.current;
        pos.x = Math.max(AVATAR_RADIUS, Math.min(CANVAS_WIDTH - AVATAR_RADIUS, pos.x + dx));
        pos.y = Math.max(AVATAR_RADIUS, Math.min(CANVAS_HEIGHT - AVATAR_RADIUS, pos.y + dy));

        if (time - lastEmit > MOVE_EMIT_INTERVAL_MS) {
          socket.emit("move", { x: pos.x, y: pos.y });
          lastEmit = time;
        }
      }

      draw();
      rafId = requestAnimationFrame(tick);
    };

    const draw = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      // Plain flat background with a light grid - intentionally simple, no flashy visuals.
      ctx.fillStyle = "#eef1f4";
      ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

      ctx.strokeStyle = "#dfe3e8";
      ctx.lineWidth = 1;
      const gridSize = 40;
      for (let x = 0; x <= CANVAS_WIDTH; x += gridSize) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, CANVAS_HEIGHT);
        ctx.stroke();
      }
      for (let y = 0; y <= CANVAS_HEIGHT; y += gridSize) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(CANVAS_WIDTH, y);
        ctx.stroke();
      }

      // Other players
      playersRef.current.forEach((p) => {
        drawAvatar(ctx, p.x, p.y, p.color, p.username, activePeers.has(p.id));
      });

      // Self (drawn last, on top, with a border to distinguish it)
      const pos = selfPosRef.current;
      drawAvatar(ctx, pos.x, pos.y, self.color, `${self.username} (you)`, activePeers.size > 0, true);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket, self, activePeers]);

  return (
    <div>
      <div className="room-header">
        <div>
          Room: <strong>{roomName}</strong> — {playersRef.current.size + 1} player(s) online
        </div>
        <div>Move with WASD or arrow keys</div>
      </div>

      <div className="room-canvas-wrap" style={{ width: CANVAS_WIDTH, height: CANVAS_HEIGHT }}>
        <canvas ref={canvasRef} width={CANVAS_WIDTH} height={CANVAS_HEIGHT} />

        <div className="call-panel">
          <div className="video-box">
            <video ref={localVideoRef} autoPlay playsInline muted />
            <span className="video-label">You</span>
          </div>

          {Array.from(activePeers.entries()).map(([peerId, username]) => (
            <RemoteVideo key={peerId} stream={remoteStreams.get(peerId)} username={username} />
          ))}
        </div>
      </div>

      {mediaError && <p className="error-text">{mediaError}</p>}
      <p className="hint">
        Walk your avatar near another player's avatar - a video call starts automatically when you're
        close enough, and ends when you walk away.
      </p>
    </div>
  );
}

function drawAvatar(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  color: string,
  label: string,
  inCall: boolean,
  isSelf = false
) {
  ctx.beginPath();
  ctx.arc(x, y, AVATAR_RADIUS, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = isSelf ? 3 : 1.5;
  ctx.strokeStyle = inCall ? "#2ecc71" : "#333";
  ctx.stroke();

  ctx.fillStyle = "#222";
  ctx.font = "12px Arial";
  ctx.textAlign = "center";
  ctx.fillText(label, x, y + AVATAR_RADIUS + 14);
}

function RemoteVideo({ stream, username }: { stream?: MediaStream; username: string }) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (ref.current && stream) {
      ref.current.srcObject = stream;
    }
  }, [stream]);

  return (
    <div className="video-box">
      <video ref={ref} autoPlay playsInline />
      <span className="video-label">{username}</span>
    </div>
  );
}
