import type { CrdtBackend, Update } from "@wb/crdt";

// alle backends schicken nur undurchsichtige bytes durch denselben kanal
export class DocTransport {
  private ws: WebSocket;
  private outbox: Uint8Array[] = [];

  constructor(
    private url: string,
    private backend: CrdtBackend,
  ) {
    this.ws = new WebSocket(url);
    this.ws.binaryType = "arraybuffer";

    this.ws.onopen = () => {
      for (const u of this.outbox) this.ws.send(asBuffer(u));
      this.outbox = [];
    };

    this.ws.onmessage = (ev: MessageEvent) => {
      if (ev.data instanceof ArrayBuffer) {
        this.backend.applyRemote(new Uint8Array(ev.data));
      }
    };

    this.backend.onLocalUpdate((u: Update) => this.send(u));
  }

  private send(u: Uint8Array): void {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(asBuffer(u));
    else this.outbox.push(u);
  }

  close(): void {
    this.ws.close();
  }
}

function asBuffer(u: Uint8Array): ArrayBuffer {
  return u.slice().buffer;
}
