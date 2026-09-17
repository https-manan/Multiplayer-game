import { useEffect, useRef } from "react";
import { io, Socket } from "socket.io-client";
import { ClientToServerEvents, ServerToClientEvents } from "../types";

const SERVER_URL = import.meta.env.VITE_SERVER_URL || "http://localhost:4000";

export type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

// Creates exactly one socket connection for the lifetime of the component
// that uses this hook, and cleans it up on unmount.
export function useSocket(): React.MutableRefObject<AppSocket | null> {
  const socketRef = useRef<AppSocket | null>(null);

  useEffect(() => {
    const socket: AppSocket = io(SERVER_URL, { transports: ["websocket"] });
    socketRef.current = socket;

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, []);

  return socketRef;
}
