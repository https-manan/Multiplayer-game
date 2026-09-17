import React, { useEffect, useState } from "react";
import { useSocket } from "./hooks/useSocket";
import Room from "./components/Room";
import { PublicPlayer } from "./types";

export default function App() {
  const socketRef = useSocket();
  const [username, setUsername] = useState("");
  const [roomName, setRoomName] = useState("lobby");
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState<{ self: PublicPlayer; players: PublicPlayer[] } | null>(
    null
  );

  useEffect(() => {
    const socket = socketRef.current;
    if (!socket) return;

    const onJoined = (data: { self: PublicPlayer; players: PublicPlayer[] }) => {
      setJoining(false);
      setSession(data);
    };
    const onError = ({ message }: { message: string }) => {
      setJoining(false);
      setError(message);
    };

    socket.on("joined", onJoined);
    socket.on("error-message", onError);

    return () => {
      socket.off("joined", onJoined);
      socket.off("error-message", onError);
    };
  }, [socketRef]);

  const handleJoin = () => {
    const socket = socketRef.current;
    if (!socket || !username.trim()) return;
    setError(null);
    setJoining(true);
    socket.emit("join", { username: username.trim(), roomName: roomName.trim() || "lobby" });
  };

  if (session) {
    return (
      <div className="app">
        <Room
          socket={socketRef.current!}
          self={session.self}
          initialPlayers={session.players}
          roomName={roomName.trim() || "lobby"}
        />
      </div>
    );
  }

  return (
    <div className="app">
      <div className="join-screen">
        <h1>Metaverse Room</h1>
        <p>Pick a name and room, then roam around and bump into people.</p>

        <input
          type="text"
          placeholder="Your name"
          value={username}
          maxLength={24}
          onChange={(e) => setUsername(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleJoin()}
        />
        <input
          type="text"
          placeholder="Room name (default: lobby)"
          value={roomName}
          maxLength={40}
          onChange={(e) => setRoomName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleJoin()}
        />
        <button onClick={handleJoin} disabled={joining || !username.trim()}>
          {joining ? "Joining..." : "Join Room"}
        </button>

        {error && <p className="error-text">{error}</p>}
      </div>
    </div>
  );
}
