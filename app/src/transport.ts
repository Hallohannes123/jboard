import type { CrdtBackend, Update } from "@wb/crdt";

export type ConnStatus = "connecting" | "open" | "offline";

const BACKOFF_MS = [500, 1000, 2000, 5000];

const OUTBOX_CAP = 512;

export class DocTransport {
  private ws: WebSocket | null = null;
  private outbox: Uint8Array[] = [];

  private coalesced = false;
  private closed = false;
  private retry = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private url: string,
    private backend: CrdtBackend,

    private onOutbound?: (bytes: number) => void,

    private onStatus?: (s: ConnStatus) => void,
  ) {
    this.backend.onLocalUpdate((u: Update) => {
      this.onOutbound?.(u.byteLength);
      this.send(u);
    });
    this.connect();
  }

  private connect(): void {
    if (this.closed) return;
    this.onStatus?.("connecting");
    const ws = new WebSocket(this.url);
    ws.binaryType = "arraybuffer";
    this.ws = ws;

    ws.onopen = () => {
      this.retry = 0;
      this.onStatus?.("open");

      if (this.coalesced) {
        ws.send(asBuffer(this.backend.getSnapshot()));
      } else {
        for (const u of this.outbox) ws.send(asBuffer(u));
      }
      this.outbox = [];
      this.coalesced = false;
    };

    ws.onmessage = (ev: MessageEvent) => {
      if (ev.data instanceof ArrayBuffer) {
        this.backend.applyRemote(new Uint8Array(ev.data));
      }
    };

    ws.onclose = () => {
      if (this.closed) return;
      this.onStatus?.("offline");
      this.scheduleReconnect();
    };
    ws.onerror = () => {
      // onclose kümmert sich gleich um den nächsten versuch
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

  private send(u: Uint8Array): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(asBuffer(u));
    else if (this.coalesced) {
      // der aktuelle snapshot enthält schon alle weiteren änderungen
    } else if (this.outbox.length >= OUTBOX_CAP) {
      // zu viele einzelne updates werden beim verbinden durch einen snapshot ersetzt
      this.outbox = [];
      this.coalesced = true;
    } else {
      this.outbox.push(u);
    }
  }

  close(): void {
    this.closed = true;
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.close();
  }
}

function asBuffer(u: Uint8Array): ArrayBuffer {
  return u.slice().buffer;
}
