import { describe, expect, it } from "vitest";
import { AutomergeBackend } from "../src/adapters/automerge.js";
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
