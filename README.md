# Metaverse Room

A minimal "metaverse" style app: users roam around a shared room as simple colored
avatars, see each other move in real time, and automatically get a peer-to-peer
video call when two avatars get close enough to each other.

Monorepo (npm workspaces):

```
metaverse-app/
├── apps/
│   ├── backend/     Express + Socket.io + Prisma ORM
│   └── frontend/    React + Vite, Canvas 2D rendering, WebRTC
└── package.json     workspace root
```

## Tech stack

- **Monorepo**: npm workspaces
- **Database / ORM**: Prisma (SQLite by default, one-line swap to Postgres)
- **Live positions**: WebSockets via Socket.io
- **Video calls**: plain WebRTC (`RTCPeerConnection` + `getUserMedia`), using the
  existing Socket.io connection only to relay offer/answer/ICE candidates (no
  external signaling or TURN service)
- **Frontend**: React + Canvas 2D, deliberately plain styling (flat background,
  grid lines, colored circle avatars + name labels - no animations or flashy UI)

## How it works

1. A user picks a name and a room and joins. The backend persists the `User`,
   `Room`, and `RoomMember` records via Prisma, and keeps their **live** x/y
   position in an in-memory map (positions change too fast/often to hit the DB
   for every frame).
2. Movement (WASD / arrow keys) is sent to the server over a WebSocket
   (`move` event) and broadcast to everyone else in the room (`player-moved`).
3. On every move, the server checks the distance between every pair of players
   in that room. When two players get within `PROXIMITY_START_DISTANCE` pixels,
   the server tells both of their clients to start a WebRTC call
   (`call-initiate`), and logs the call in the DB (`CallLog`). When they drift
   apart past `PROXIMITY_END_DISTANCE`, the server tells both clients to end
   the call (`call-end`) and stamps the `CallLog.endedAt`.
4. The two clients then do a normal WebRTC handshake (offer → answer → ICE
   candidates), relayed through the socket connection as generic `signal`
   events. Once connected, video/audio flows directly peer-to-peer.

## Setup

### 1. Install dependencies

```bash
npm install
```

(installs both `apps/backend` and `apps/frontend` via workspaces)

### 2. Backend: configure env + database

```bash
cd apps/backend
cp .env.example .env
npm run prisma:migrate   # creates the SQLite dev.db and applies the schema
npm run prisma:generate  # (usually run automatically by migrate)
```

### 3. Frontend: configure env

```bash
cd apps/frontend
cp .env.example .env
```

### 4. Run both apps (two terminals, from the repo root)

```bash
npm run dev:backend    # http://localhost:4000
npm run dev:frontend   # http://localhost:5173
```

Open `http://localhost:5173` in two different browser tabs/windows (or two
devices), join the same room name with two different usernames, allow camera/
mic access, and walk the avatars toward each other with WASD/arrow keys.

## Switching to Postgres

In `apps/backend/prisma/schema.prisma`, change:

```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}
```

and set `DATABASE_URL` in `apps/backend/.env` to your Postgres connection
string, then re-run `npm run prisma:migrate`.

## Notes / things you may want to extend

- Only STUN (`stun:stun.l.google.com:19302`) is configured for WebRTC. On
  restrictive networks (some corporate/mobile NATs) peer-to-peer connection can
  fail without a TURN server - add one to `ICE_SERVERS` in
  `apps/frontend/src/webrtc/webrtc.ts` if needed.
- Proximity thresholds are configurable via `PROXIMITY_START_DISTANCE` /
  `PROXIMITY_END_DISTANCE` in `apps/backend/.env`.
- Room capacity, avatar shapes/colors, and canvas size are intentionally kept
  simple in `apps/frontend/src/components/Room.tsx` - easy to reskin later.
# Multiplayer-game
