import type { PresenceChannel, PresenceState } from "@wb/crdt";

const PEER_TIMEOUT = 5000;
const HEARTBEAT = 2000;
// cursor-events höchstens einmal pro frame verschicken
const COALESCE_MS = 16;

const BACKOFF_MS = [500, 1000, 2000, 5000];

type Envelope = { peer: string; state: PresenceState };

const scheduleFrame = (fn: () => void): (() => void) => {
  if (typeof requestAnimationFrame === "function") {
    const h = requestAnimationFrame(fn);
    return () => cancelAnimationFrame(h);
  }
  const h = setTimeout(fn, COALESCE_MS);
  return () => clearTimeout(h);
};

export class RelayPresence implements PresenceChannel {
  private ws: WebSocket | null = null;
  private peers = new Map<string, { state: PresenceState; seen: number }>();
  private local: PresenceState | null = null;
  private cb: ((peers: Map<string, PresenceState>) => void) | null = null;
  private heartbeat: ReturnType<typeof setInterval>;

  private cancelFlush: (() => void) | null = null;

  private closed = false;
  private retry = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private url: string,
    private peerId: string,
  ) {
    this.connect();

    this.heartbeat = setInterval(() => {
      this.expire();
      if (this.local !== null) this.broadcast();
    }, HEARTBEAT);
  }

  private connect(): void {
    if (this.closed) return;
    const ws = new WebSocket(this.url);
    this.ws = ws;

    ws.binaryType = "arraybuffer";
    ws.onmessage = (ev: MessageEvent) => this.receive(ev.data);
    ws.onopen = () => {
      this.retry = 0;
      if (this.local !== null) this.broadcast();
    };

    ws.onclose = () => {
      if (this.closed) return;
      this.scheduleReconnect();
    };
    ws.onerror = () => {
      ws.close();
    };
  }

  private scheduleReconnect(): void {
    if (this.closed || this.reconnectTimer !== null) return;
    const delay = BACKOFF_MS[Math.min(this.retry, BACKOFF_MS.length - 1)]!;
    this.retry++;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  setLocal(state: PresenceState): void {
    this.local = state;

    if (this.cancelFlush !== null) return;
    this.cancelFlush = scheduleFrame(() => {
      this.cancelFlush = null;
      this.broadcast();
    });
  }

  onRemote(cb: (peers: Map<string, PresenceState>) => void): void {
    this.cb = cb;
  }

  private broadcast(): void {
    if (this.ws?.readyState !== WebSocket.OPEN || this.local === null) return;
    const env: Envelope = { peer: this.peerId, state: this.local };
    this.ws.send(JSON.stringify(env));
  }

  private receive(data: unknown): void {
    let text: string;
    if (typeof data === "string") {
      text = data;
    } else if (data instanceof ArrayBuffer) {
      text = new TextDecoder().decode(data);
    } else if (typeof Blob !== "undefined" && data instanceof Blob) {
      void data.text().then((s) => this.receive(s));
      return;
    } else if (ArrayBuffer.isView(data)) {
      text = new TextDecoder().decode(data as ArrayBufferView);
    } else {
      return;
    }
    let env: Envelope;
    try {
      env = JSON.parse(text) as Envelope;
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
    this.closed = true;
    clearInterval(this.heartbeat);
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.cancelFlush !== null) {
      this.cancelFlush();
      this.cancelFlush = null;
    }
    this.ws?.close();
  }
}
