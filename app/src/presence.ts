import type { PresenceChannel, PresenceState } from "@wb/crdt";

// presence läuft getrennt vom dokument und wird nicht gespeichert
const PEER_TIMEOUT = 5000;
const HEARTBEAT = 2000;

type Envelope = { peer: string; state: PresenceState };

export class RelayPresence implements PresenceChannel {
  private ws: WebSocket;
  private peers = new Map<string, { state: PresenceState; seen: number }>();
  private local: PresenceState | null = null;
  private cb: ((peers: Map<string, PresenceState>) => void) | null = null;
  private heartbeat: ReturnType<typeof setInterval>;

  constructor(
    url: string,
    private peerId: string,
  ) {
    this.ws = new WebSocket(url);
    this.ws.onmessage = (ev: MessageEvent) => this.receive(ev.data);
    this.ws.onopen = () => {
      if (this.local !== null) this.broadcast();
    };

    this.heartbeat = setInterval(() => {
      this.expire();
      if (this.local !== null) this.broadcast();
    }, HEARTBEAT);
  }

  setLocal(state: PresenceState): void {
    this.local = state;
    this.broadcast();
  }

  onRemote(cb: (peers: Map<string, PresenceState>) => void): void {
    this.cb = cb;
  }

  private broadcast(): void {
    if (this.ws.readyState !== WebSocket.OPEN || this.local === null) return;
    const env: Envelope = { peer: this.peerId, state: this.local };
    this.ws.send(JSON.stringify(env));
  }

  private receive(data: unknown): void {
    if (typeof data !== "string") return;
    let env: Envelope;
    try {
      env = JSON.parse(data) as Envelope;
    } catch {
      return;
    }
    if (env.peer === this.peerId) return;
    this.peers.set(env.peer, { state: env.state, seen: Date.now() });
    this.emit();
  }

  private expire(): void {
    const now = Date.now();
    let changed = false;
    for (const [id, entry] of this.peers) {
      if (now - entry.seen > PEER_TIMEOUT) {
        this.peers.delete(id);
        changed = true;
      }
    }
    if (changed) this.emit();
  }

  private emit(): void {
    if (this.cb === null) return;
    const view = new Map<string, PresenceState>();
    for (const [id, entry] of this.peers) view.set(id, entry.state);
    this.cb(view);
  }

  close(): void {
    clearInterval(this.heartbeat);
    this.ws.close();
  }
}
