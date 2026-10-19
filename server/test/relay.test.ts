import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer } from "node:http";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { WebSocket } from "ws";
import { createRelay } from "../src/index.js";

// in manchen ci-umgebungen dürfen tests keinen port öffnen
const canBind = await new Promise<boolean>((resolve) => {
  const probe = createServer();
  probe.once("error", () => resolve(false));
  probe.listen(0, "127.0.0.1", () => probe.close(() => resolve(true)));
});

let server: Server | null = null;
let port = 0;

describe.skipIf(!canBind)("relay", () => {
  beforeAll(async () => {
    server = createRelay();
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    port = (server!.address() as AddressInfo).port;
  });

  afterAll(async () => {
    if (server !== null) {
      await new Promise<void>((resolve) => server!.close(() => resolve()));
    }
  });

  function open(path: string): Promise<WebSocket> {
    const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`);
    ws.binaryType = "nodebuffer";
    return new Promise((resolve, reject) => {
      ws.once("open", () => resolve(ws));
      ws.once("error", reject);
    });
  }

  function nextMessage(ws: WebSocket): Promise<Buffer> {
    return new Promise((resolve) => {
      ws.once("message", (data) => resolve(data as Buffer));
    });
  }

  // die erste nachricht kann direkt beim verbinden kommen
  function openCapturingFirst(path: string): {
    ws: WebSocket;
    first: Promise<Buffer>;
  } {
    const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`);
    ws.binaryType = "nodebuffer";
    const first = new Promise<Buffer>((resolve) => {
      ws.once("message", (data) => resolve(data as Buffer));
    });
    return { ws, first };
  }

  it("fans a doc blob out to other peers in the same room but not the sender", async () => {
    const a = await open("/doc/room1");
    const b = await open("/doc/room1");
    const got = nextMessage(b);
    let aEchoed = false;
    a.once("message", () => (aEchoed = true));

    const blob = Buffer.from([1, 2, 3, 4]);
    a.send(blob);

    expect(await got).toEqual(blob);
    expect(aEchoed).toBe(false);
    a.close();
    b.close();
  });

  it("keeps rooms isolated", async () => {
    const a = await open("/doc/roomA");
    const other = await open("/doc/roomB");
    let leaked = false;
    other.once("message", () => (leaked = true));

    a.send(Buffer.from([9]));
    await new Promise((r) => setTimeout(r, 30));

    expect(leaked).toBe(false);
    a.close();
    other.close();
  });

  it("replays the last doc snapshot to a late joiner", async () => {
    const a = await open("/doc/late");
    a.send(Buffer.from([7, 7, 7]));
    await new Promise((r) => setTimeout(r, 20));

    const { ws: b, first } = openCapturingFirst("/doc/late");
    expect(await first).toEqual(Buffer.from([7, 7, 7]));
    a.close();
    b.close();
  });

  it("keeps doc and presence on separate channels", async () => {
    const doc = await open("/doc/mix");
    const presence = await open("/presence/mix");
    let docLeaked = false;
    doc.once("message", () => (docLeaked = true));

    presence.send(Buffer.from([5, 5]));
    await new Promise((r) => setTimeout(r, 30));

    expect(docLeaked).toBe(false);
    doc.close();
    presence.close();
  });
});
