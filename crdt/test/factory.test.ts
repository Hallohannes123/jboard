import { describe, expect, it } from "vitest";
import { createBackend } from "../src/factory.js";
import type { CrdtBackend } from "../src/backend.js";
import { keyBetween, type Shape } from "../src/model.js";

const KINDS: CrdtBackend["kind"][] = ["yjs", "automerge", "loro"];

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

describe.each(KINDS)("factory-created backend: %s", (kind) => {
  it("is reachable through createBackend and reports its kind", () => {
    const be = createBackend(kind);
    expect(be.kind).toBe(kind);
  });

  it("converges two replicas to byte-identical state", () => {
    const a = createBackend(kind);
    const b = createBackend(kind);
    a.onLocalUpdate((u) => b.applyRemote(u));
    b.onLocalUpdate((u) => a.applyRemote(u));

    const z = keyBetween(null, null);
    a.putShape(makeShape("s1", z, { x: 5 }));
    b.putShape(makeShape("s2", keyBetween(z, null), { text: "peer" }));
    a.patchShape("s1", { x: 42, fill: "#f00" });
    b.deleteShape("s2");

    expect(a.getAllShapes()).toEqual(b.getAllShapes());
  });

  it("reports a wasmMemoryBytes reading consistent with its backing", () => {
    const be = createBackend(kind);
    const bytes = be.wasmMemoryBytes?.() ?? null;
    if (kind === "loro") {
      expect(typeof bytes).toBe("number");
      expect(bytes as number).toBeGreaterThan(0);
    } else {
      expect(bytes).toBeNull();
    }
  });

  it("re-putting a shape without an optional field removes it (C2)", () => {
    const be = createBackend(kind);
    const z = keyBetween(null, null);
    be.putShape(makeShape("s1", z, { text: "hello", points: [1, 2, 3] }));
    be.putShape(makeShape("s1", z));

    const s = be.getShape("s1");
    expect(s?.text).toBeUndefined();
    expect(s?.points).toBeUndefined();
  });
});

describe("cross-adapter neutral-state agreement", () => {
  function finalState(kind: CrdtBackend["kind"], run: (be: CrdtBackend) => void): Shape[] {
    const be = createBackend(kind);
    run(be);
    return be.getAllShapes();
  }

  function expectAllAgree(run: (be: CrdtBackend) => void): void {
    const [y, a, l] = KINDS.map((k) => finalState(k, run));
    expect(a).toEqual(y);
    expect(l).toEqual(y);
  }

  it("agree after a putShape that removes an optional field (C2)", () => {
    const z = keyBetween(null, null);
    expectAllAgree((be) => {
      be.putShape(makeShape("s1", z, { text: "hello", points: [1, 2, 3] }));
      be.putShape(makeShape("s1", z));
    });
  });

  it("concurrent edits to disjoint fields both survive on all three arms (C3)", () => {
    const z = keyBetween(null, null);
    for (const kind of KINDS) {
      const a = createBackend(kind);
      const b = createBackend(kind);
      a.putShape(makeShape("s1", z, { text: "keep" }));
      b.load(a.getSnapshot());

      const toA: Uint8Array[] = [];
      const toB: Uint8Array[] = [];
      a.onLocalUpdate((u) => toB.push(u));
      b.onLocalUpdate((u) => toA.push(u));
      a.patchShape("s1", { x: 99 });
      b.patchShape("s1", { fill: "#f00" });
      for (const u of toB) b.applyRemote(u);
      for (const u of toA) a.applyRemote(u);

      const s = a.getShape("s1");
      expect(s?.x, `${kind}: a's x edit lost`).toBe(99);
      expect(s?.fill, `${kind}: b's fill edit lost`).toBe("#f00");
      expect(s?.text, `${kind}: seeded text lost`).toBe("keep");
      expect(a.getAllShapes(), `${kind}: replicas diverged`).toEqual(b.getAllShapes());
    }
  });

  it("applyRemote accepts a full-state snapshot as one coalesced update (A4)", () => {
    const z = keyBetween(null, null);
    for (const kind of KINDS) {
      const author = createBackend(kind);
      author.putShape(makeShape("s1", z, { text: "keep" }));
      author.putShape(makeShape("s2", keyBetween(z, null), { x: 7 }));
      const snapshot = author.getSnapshot();

      const peer = createBackend(kind);
      peer.applyRemote(snapshot);
      expect(peer.getAllShapes(), `${kind}: snapshot didn't materialise`).toEqual(
        author.getAllShapes(),
      );
    }
  });

  it("transact() coalesces a multi-op batch into ONE update on every arm (C5)", () => {
    const z = keyBetween(null, null);
    for (const kind of KINDS) {
      const be = createBackend(kind);
      const updates: Uint8Array[] = [];
      be.onLocalUpdate((u) => updates.push(u));
      be.transact(() => {
        be.putShape(makeShape("s1", z, { x: 1 }));
        be.putShape(makeShape("s2", keyBetween(z, null), { x: 2 }));
        be.patchShape("s1", { x: 99 });
      });
      expect(updates.length, `${kind}: batch should emit exactly one update`).toBe(1);
    }
  });

  it("a transact() batch is a SINGLE undo step on every arm (C5)", () => {
    const z = keyBetween(null, null);
    for (const kind of KINDS) {
      const be = createBackend(kind);
      be.transact(() => {
        be.putShape(makeShape("s1", z));
        be.putShape(makeShape("s2", keyBetween(z, null)));
      });
      expect(be.getAllShapes().length, `${kind}: batch didn't apply`).toBe(2);
      be.undo();
      expect(be.getAllShapes().length, `${kind}: one undo should revert the whole batch`).toBe(0);
    }
  });

  it("a transact() batch applies intra-batch ops in order on every arm (C5)", () => {
    const z = keyBetween(null, null);
    for (const kind of KINDS) {
      const be = createBackend(kind);
      be.transact(() => {
        be.putShape(makeShape("s1", z, { x: 1 }));
        be.putShape(makeShape("s2", keyBetween(z, null)));
        be.patchShape("s1", { x: 99 });
        be.deleteShape("s2");
      });
      const shapes = be.getAllShapes();
      expect(
        shapes.map((s) => s.id),
        `${kind}: batch left wrong shapes`,
      ).toEqual(["s1"]);
      expect(shapes[0]?.x, `${kind}: intra-batch patch didn't apply`).toBe(99);
    }
  });

  it("load() fires the change subscribers on every arm (C6)", () => {
    const z = keyBetween(null, null);
    for (const kind of KINDS) {
      const author = createBackend(kind);
      author.putShape(makeShape("snap1", z));
      const snapshot = author.getSnapshot();

      const replica = createBackend(kind);
      let fired = 0;
      replica.subscribe(() => fired++);
      replica.load(snapshot);
      expect(fired, `${kind}: load didn't notify subscribers`).toBeGreaterThan(0);
    }
  });

  it("onLocalUpdate keeps a single subscriber — re-register replaces, never stacks (C7)", () => {
    const z = keyBetween(null, null);
    for (const kind of KINDS) {
      const be = createBackend(kind);
      let first = 0;
      let second = 0;
      be.onLocalUpdate(() => first++);
      be.onLocalUpdate(() => second++);
      be.putShape(makeShape("s1", z));
      expect(first, `${kind}: the replaced callback must not fire`).toBe(0);
      expect(second, `${kind}: the current callback fires exactly once per op`).toBe(1);
    }
  });

  it("load() REPLACES the live doc — prior local state is dropped (C6)", () => {
    const z = keyBetween(null, null);
    for (const kind of KINDS) {
      const author = createBackend(kind);
      author.putShape(makeShape("snap1", z, { text: "from-snapshot" }));
      const snapshot = author.getSnapshot();

      const replica = createBackend(kind);
      replica.putShape(makeShape("local1", z, { text: "local-only" }));
      replica.load(snapshot);

      const ids = replica.getAllShapes().map((s) => s.id);
      expect(ids, `${kind}: prior local shape survived a load`).toEqual(["snap1"]);
      expect(replica.getAllShapes(), `${kind}: load didn't match the snapshot`).toEqual(
        author.getAllShapes(),
      );
    }
  });

  it("a load()-replaced replica still emits local updates to its subscriber (C6)", () => {
    const z = keyBetween(null, null);
    for (const kind of KINDS) {
      const author = createBackend(kind);
      author.putShape(makeShape("snap1", z));
      const snapshot = author.getSnapshot();

      const replica = createBackend(kind);
      let emits = 0;
      replica.onLocalUpdate(() => emits++);
      replica.load(snapshot);
      replica.putShape(makeShape("after", keyBetween(z, null)));
      expect(emits, `${kind}: no local update after load`).toBeGreaterThan(0);
    }
  });
});
