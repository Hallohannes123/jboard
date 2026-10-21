import { createServer, type IncomingMessage } from "node:http";
import { WebSocketServer, WebSocket, type RawData } from "ws";

const PORT = Number(process.env.PORT ?? 8787);

function roomOf(req: IncomingMessage, prefix: string): string | null {
  const url = req.url ?? "";
  if (!url.startsWith(prefix)) return null;
  const room = decodeURIComponent(url.slice(prefix.length)).split("?")[0] ?? "";
  return room.length > 0 ? room : null;
}

function toBuffer(data: RawData): Buffer {
  if (Buffer.isBuffer(data)) return data;
  if (Array.isArray(data)) return Buffer.concat(data);
  return Buffer.from(data);
}

class Rooms {
  private peers = new Map<string, Set<WebSocket>>();

  join(room: string, ws: WebSocket): void {
    let set = this.peers.get(room);
    if (set === undefined) {
      set = new Set();
      this.peers.set(room, set);
    }
    set.add(ws);
  }

  leave(room: string, ws: WebSocket): void {
    const set = this.peers.get(room);
    if (set === undefined) return;
    set.delete(ws);
    if (set.size === 0) this.peers.delete(room);
  }

  broadcast(room: string, from: WebSocket, blob: Buffer): void {
    const set = this.peers.get(room);
    if (set === undefined) return;
    for (const peer of set) {
      if (peer !== from && peer.readyState === WebSocket.OPEN) peer.send(blob);
    }
  }
}

export function createRelay() {
  const http = createServer();
  const docRooms = new Rooms();
  const presenceRooms = new Rooms();

  const MAX_LOG = 10_000;
  // alle verpassten updates in reihenfolge nachliefern
  const docLog = new Map<string, Buffer[]>();

  const docWss = new WebSocketServer({ noServer: true });
  const presenceWss = new WebSocketServer({ noServer: true });

  docWss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
    const room = roomOf(req, "/doc/");
    if (room === null) {
      ws.close(1008, "missing room");
      return;
    }
    docRooms.join(room, ws);

    for (const blob of docLog.get(room) ?? []) ws.send(blob);

    ws.on("message", (data: RawData) => {
      const blob = toBuffer(data);
      let log = docLog.get(room);
      if (log === undefined) {
        log = [];
        docLog.set(room, log);
      }
      log.push(blob);
      if (log.length > MAX_LOG) log.shift();
      docRooms.broadcast(room, ws, blob);
    });
    ws.on("close", () => docRooms.leave(room, ws));
  });

  presenceWss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
    const room = roomOf(req, "/presence/");
    if (room === null) {
      ws.close(1008, "missing room");
      return;
    }
    presenceRooms.join(room, ws);
    ws.on("message", (data: RawData) => {
      presenceRooms.broadcast(room, ws, toBuffer(data));
    });
    ws.on("close", () => presenceRooms.leave(room, ws));
  });

  http.on("upgrade", (req, socket, head) => {
    const url = req.url ?? "";
    if (url.startsWith("/doc/")) {
      docWss.handleUpgrade(req, socket, head, (ws) => docWss.emit("connection", ws, req));
    } else if (url.startsWith("/presence/")) {
      presenceWss.handleUpgrade(req, socket, head, (ws) => presenceWss.emit("connection", ws, req));
    } else {
      socket.destroy();
    }
  });

  return http;
}

if (process.argv[1] !== undefined && import.meta.url.endsWith(process.argv[1])) {
  createRelay().listen(PORT, () => {
    process.stdout.write(`relay on ws://localhost:${PORT} (/doc, /presence)\n`);
  });
}
