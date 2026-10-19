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

  // an alle im raum außer den absender schicken
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
  const lastDocSnapshot = new Map<string, Buffer>();

  const docWss = new WebSocketServer({ noServer: true });
  const presenceWss = new WebSocketServer({ noServer: true });

  docWss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
    const room = roomOf(req, "/doc/");
    if (room === null) {
      ws.close(1008, "missing room");
      return;
    }
    docRooms.join(room, ws);

    // der letzte stand reicht neuen teilnehmern zum aufholen
    const cached = lastDocSnapshot.get(room);
    if (cached !== undefined) ws.send(cached);

    ws.on("message", (data: RawData) => {
      const blob = toBuffer(data);
      lastDocSnapshot.set(room, blob);
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

  // dokument und presence bleiben zwei getrennte kanäle
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
