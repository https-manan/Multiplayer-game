import { AppSocket } from "../hooks/useSocket";

const ICE_SERVERS: RTCIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];

interface SignalPayload {
  type: "offer" | "answer" | "ice-candidate";
  data: unknown;
}

interface PeerCallOptions {
  socket: AppSocket;
  peerId: string;
  initiator: boolean;
  localStream: MediaStream;
  onRemoteStream: (stream: MediaStream) => void;
  onClose: () => void;
}

// Wraps one RTCPeerConnection for a single call with one peer, using the
// existing socket.io connection purely as a signaling relay (plain WebRTC
// otherwise - no external signaling/TURN service involved).
export class PeerCall {
  private pc: RTCPeerConnection;
  private socket: AppSocket;
  private peerId: string;
  private closed = false;

  constructor(opts: PeerCallOptions) {
    this.socket = opts.socket;
    this.peerId = opts.peerId;
    this.pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

    opts.localStream.getTracks().forEach((track) => {
      this.pc.addTrack(track, opts.localStream);
    });

    this.pc.ontrack = (event) => {
      opts.onRemoteStream(event.streams[0]);
    };

    this.pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.sendSignal({ type: "ice-candidate", data: event.candidate });
      }
    };

    this.pc.onconnectionstatechange = () => {
      if (["closed", "failed", "disconnected"].includes(this.pc.connectionState)) {
        this.cleanup(opts.onClose);
      }
    };

    if (opts.initiator) {
      this.makeOffer();
    }
  }

  private sendSignal(payload: SignalPayload) {
    this.socket.emit("signal", { to: this.peerId, signal: payload });
  }

  private async makeOffer() {
    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    this.sendSignal({ type: "offer", data: offer });
  }

  // Called by the parent component whenever a "signal" event arrives from this peer.
  async handleSignal(signal: SignalPayload) {
    if (this.closed) return;

    if (signal.type === "offer") {
      await this.pc.setRemoteDescription(new RTCSessionDescription(signal.data as RTCSessionDescriptionInit));
      const answer = await this.pc.createAnswer();
      await this.pc.setLocalDescription(answer);
      this.sendSignal({ type: "answer", data: answer });
    } else if (signal.type === "answer") {
      await this.pc.setRemoteDescription(new RTCSessionDescription(signal.data as RTCSessionDescriptionInit));
    } else if (signal.type === "ice-candidate") {
      try {
        await this.pc.addIceCandidate(new RTCIceCandidate(signal.data as RTCIceCandidateInit));
      } catch (err) {
        console.error("Error adding ICE candidate", err);
      }
    }
  }

  private cleanup(onClose: () => void) {
    if (this.closed) return;
    this.closed = true;
    onClose();
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.pc.close();
  }
}
