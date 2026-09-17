// Live (in-memory) presence of one connected user inside a room.
// This is NOT stored in the DB because it changes many times per second -
// only the fact that "this user joined this room at some point" is persisted
// (see RoomMember in prisma/schema.prisma).
export interface LivePlayer {
  socketId: string;
  userId: string;
  username: string;
  roomName: string;
  x: number;
  y: number;
  color: string;
}

export interface PublicPlayer {
  id: string; // socketId - what the frontend keys players by
  userId: string;
  username: string;
  x: number;
  y: number;
  color: string;
}

// Client -> Server events
export interface ClientToServerEvents {
  join: (data: { username: string; roomName: string }) => void;
  move: (data: { x: number; y: number }) => void;
  signal: (data: { to: string; signal: unknown }) => void;
  "call-ready": (data: { to: string }) => void;
  "leave-call": (data: { with: string }) => void;
}

// Server -> Client events
export interface ServerToClientEvents {
  joined: (data: { self: PublicPlayer; players: PublicPlayer[] }) => void;
  "player-joined": (data: { player: PublicPlayer }) => void;
  "player-moved": (data: { id: string; x: number; y: number }) => void;
  "player-left": (data: { id: string }) => void;
  "call-initiate": (data: { peerId: string; peerUsername: string; initiator: boolean }) => void;
  "call-end": (data: { peerId: string }) => void;
  signal: (data: { from: string; signal: unknown }) => void;
  "error-message": (data: { message: string }) => void;
}
