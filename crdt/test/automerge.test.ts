import { describe, expect, it } from "vitest";
import { AutomergeBackend, UNDO_LIMIT } from "../src/adapters/automerge.js";
import { keyBetween, type Shape } from "../src/model.js";

function makeShape(id: string, z: string, over: Partial<Shape> = {}): Shape {
  return {
    id,
    kind: "rect",
    x: 0,
    y: 0,
    w: 10,
    h: 10,
    rotation: 0,
    z,
    fill: "#fff",
    stroke: "#000",
    strokeWidth: 1,
    ...over,
  };
}

function connect(a: AutomergeBackend, b: AutomergeBackend): void {
  a.onLocalUpdate((u) => b.applyRemote(u));
  b.onLocalUpdate((u) => a.applyRemote(u));
}

describe("automerge adapter", () => {
  it("round-trips a shape through the neutral model", () => {
    const be = new AutomergeBackend();
    const s = makeShape("s1", keyBetween(null, null), { fill: "#abc", text: "hi" });
    be.putShape(s);
    expect(be.getShape("s1")).toEqual(s);
    expect(be.getAllShapes()).toHaveLength(1);
  });

  it("converges two replicas to byte-identical state under live sync", () => {
    const a = new AutomergeBackend();
    const b = new AutomergeBackend();
    connect(a, b);

    const z = keyBetween(null, null);
    a.putShape(makeShape("s1", z, { x: 5 }));
    b.putShape(makeShape("s2", keyBetween(z, null), { x: 9 }));
    a.patchShape("s1", { x: 42, fill: "#f00" });
    b.patchShape("s2", { rotation: 1.5 });

    expect(a.getSnapshot()).toEqual(b.getSnapshot());
    expect(a.getAllShapes()).toEqual(b.getAllShapes());
  });

  it("converges regardless of the order updates arrive", () => {
    const a = new AutomergeBackend();
    const b = new AutomergeBackend();
    const toB: Uint8Array[] = [];
    const toA: Uint8Array[] = [];
    a.onLocalUpdate((u) => toB.push(u));
    b.onLocalUpdate((u) => toA.push(u));

    const z0 = keyBetween(null, null);
    a.putShape(makeShape("a1", z0));
    a.patchShape("a1", { x: 3 });
    a.patchShape("a1", { x: 7 });
    b.putShape(makeShape("b1", keyBetween(z0, null)));
    b.deleteShape("b1");
    b.putShape(makeShape("b2", keyBetween(z0, null), { fill: "#0f0" }));

    for (const u of toB) b.applyRemote(u);
    for (const u of [...toA].reverse()) a.applyRemote(u);

    expect(a.getSnapshot()).toEqual(b.getSnapshot());
    expect(a.getAllShapes()).toEqual(b.getAllShapes());
  });

  it("undo reverts a local edit but keeps a concurrent remote edit", () => {
    const a = new AutomergeBackend();
    const b = new AutomergeBackend();
    connect(a, b);

    const z = keyBetween(null, null);
    a.putShape(makeShape("s1", z, { x: 1 }));
    b.patchShape("s1", { fill: "#123" });
    a.patchShape("s1", { x: 99 });
    a.undo();

    const s = a.getShape("s1");
    expect(s?.x).toBe(1);
    expect(s?.fill).toBe("#123");
    expect(a.getSnapshot()).toEqual(b.getSnapshot());
  });

  it("undo of a local create keeps a shape a peer created concurrently (C1)", () => {
    const a = new AutomergeBackend();
    const b = new AutomergeBackend();
    connect(a, b);

    const z = keyBetween(null, null);
    a.putShape(makeShape("s1", z));
    b.putShape(makeShape("s2", keyBetween(z, null)));
    a.undo();

    const ids = a.getAllShapes().map((s) => s.id);
    expect(ids).not.toContain("s1");
    expect(ids).toContain("s2");
    expect(a.getAllShapes()).toEqual(b.getAllShapes());
  });

  it("undo of a local field edit keeps a peer's edit to a different field (C1)", () => {
    const a = new AutomergeBackend();
    const b = new AutomergeBackend();
    connect(a, b);

    const z = keyBetween(null, null);
    a.putShape(makeShape("s1", z, { x: 1, fill: "#fff" }));
    a.patchShape("s1", { x: 99 });
    b.patchShape("s1", { fill: "#f00" });
    a.undo();

    const s = a.getShape("s1");
    expect(s?.x).toBe(1);
    expect(s?.fill).toBe("#f00");
    expect(a.getAllShapes()).toEqual(b.getAllShapes());
  });

  it("redo reapplies an undone local create without disturbing remote work (C1)", () => {
    const a = new AutomergeBackend();
    const b = new AutomergeBackend();
    connect(a, b);

    const z = keyBetween(null, null);
    a.putShape(makeShape("s1", z));
    b.putShape(makeShape("s2", keyBetween(z, null)));
    a.undo();
    a.redo();

    const ids = a.getAllShapes().map((s) => s.id);
    expect(ids).toContain("s1");
    expect(ids).toContain("s2");
    expect(a.getAllShapes()).toEqual(b.getAllShapes());
  });

  it("bounds the undo stack to a fixed depth, dropping the oldest frames (C9)", () => {
    const be = new AutomergeBackend();
    const total = UNDO_LIMIT + 5;
    let prev: string | null = null;
    for (let i = 0; i < total; i++) {
      const z = keyBetween(prev, null);
      be.putShape(makeShape(`s${i}`, z));
      prev = z;
    }

    for (let i = 0; i < total + 10; i++) be.undo();

    expect(be.getAllShapes()).toHaveLength(total - UNDO_LIMIT);
    const ids = be.getAllShapes().map((s) => s.id);
    expect(ids).toContain("s0");
    expect(ids).not.toContain(`s${total - 1}`);
  });

  it("a no-op undo emits nothing and leaves the redo stack usable (C10)", () => {
    const a = new AutomergeBackend();
    const b = new AutomergeBackend();
    const toA: Uint8Array[] = [];
    const toB: Uint8Array[] = [];
    a.onLocalUpdate((u) => toB.push(u));
    b.onLocalUpdate((u) => toA.push(u));

    const z = keyBetween(null, null);
    a.putShape(makeShape("s1", z));
    for (const u of toB) b.applyRemote(u);
    toB.length = 0;
    b.deleteShape("s1");
    for (const u of toA) a.applyRemote(u);
    toB.length = 0;

    let emits = 0;
    a.onLocalUpdate(() => emits++);
    a.undo();
    expect(emits, "a no-op undo must not emit").toBe(0);
    expect(a.getShape("s1")).toBeUndefined();

    a.redo();
    expect(emits, "a redo of a no-op undo must not emit").toBe(0);
    expect(a.getShape("s1")).toBeUndefined();
  });

  it("fires subscribe on local and remote changes", () => {
    const a = new AutomergeBackend();
    const b = new AutomergeBackend();
    connect(a, b);

    let hits = 0;
    const off = a.subscribe(() => hits++);
    a.putShape(makeShape("s1", keyBetween(null, null)));
    b.putShape(makeShape("s2", keyBetween(null, null)));
    off();
    a.putShape(makeShape("s3", keyBetween(null, null)));

    expect(hits).toBe(2);
  });

  it("loads a snapshot into a fresh replica", () => {
    const a = new AutomergeBackend();
    a.putShape(makeShape("s1", keyBetween(null, null), { text: "kept" }));
    const snap = a.getSnapshot();

    const c = new AutomergeBackend();
    c.load(snap);
    expect(c.getShape("s1")?.text).toBe("kept");
    expect(c.getSnapshot()).toEqual(snap);
  });
});
