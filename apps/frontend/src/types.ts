export interface PublicPlayer {
  id: string; // socket id
  userId: string;
  username: string;
  x: number;
  y: number;
  color: string;
}

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

export interface ClientToServerEvents {
  join: (data: { username: string; roomName: string }) => void;
  move: (data: { x: number; y: number }) => void;
  signal: (data: { to: string; signal: unknown }) => void;
  "call-ready": (data: { to: string }) => void;
  "leave-call": (data: { with: string }) => void;
}
