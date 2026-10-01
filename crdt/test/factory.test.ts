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
});
