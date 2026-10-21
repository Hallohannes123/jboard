import type { Shape, ShapeId } from "@wb/crdt";
import { keyBetween } from "@wb/crdt";
import { intBetween, mulberry32, pick } from "./rng.js";

export type Op =
  | { t: "put"; shape: Shape }
  | { t: "patch"; id: ShapeId; patch: Partial<Shape> }
  | { t: "delete"; id: ShapeId };

export interface ClientTrace {
  client: number;
  ops: Op[];
}

export interface Trace {
  id: string;

  clients: ClientTrace[];
}

const KINDS = ["rect", "ellipse", "line", "draw", "text"] as const;
const COLORS = ["#e11", "#1a1", "#11e", "#ee1", "#1ee", "#e1e", "#222", "#eee"] as const;

function makeShape(rng: () => number, id: ShapeId, z: string): Shape {
  const kind = pick(rng, KINDS);
  const s: Shape = {
    id,
    kind,
    x: intBetween(rng, 0, 1000),
    y: intBetween(rng, 0, 700),
    w: intBetween(rng, 10, 200),
    h: intBetween(rng, 10, 200),
    rotation: 0,
    z,
    fill: pick(rng, COLORS),
    stroke: "#000",
    strokeWidth: intBetween(rng, 1, 5),
  };
  if (kind === "line" || kind === "draw") {
    const n = intBetween(rng, 2, 8);
    s.points = Array.from({ length: n * 2 }, () => intBetween(rng, 0, 1000));
  }
  if (kind === "text") s.text = `t${intBetween(rng, 0, 9999)}`;
  return s;
}

export function traceS1(seed: number, edits = 500): Trace {
  const rng = mulberry32(seed);
  const ops: Op[] = [];
  let z: string | null = null;
  const ids: ShapeId[] = [];
  for (let i = 0; i < edits; i++) {
    if (ids.length === 0 || rng() < 0.15) {
      z = keyBetween(z, null);
      const id = `s1-${i}`;
      ids.push(id);
      ops.push({ t: "put", shape: makeShape(rng, id, z) });
    } else {
      const id = pick(rng, ids);
      ops.push({
        t: "patch",
        id,
        patch: { x: intBetween(rng, 0, 1000), y: intBetween(rng, 0, 700) },
      });
    }
  }
  return { id: "S1-seq-typing", clients: [{ client: 0, ops }] };
}

export function traceS2(seed: number, k: number, opsPerClient = 100): Trace {
  const clients: ClientTrace[] = [];
  for (let c = 0; c < k; c++) {
    const rng = mulberry32(seed + c * 1009);
    const ops: Op[] = [];
    let z: string | null = null;
    const ids: ShapeId[] = [];
    for (let i = 0; i < opsPerClient; i++) {
      if (ids.length === 0 || rng() < 0.2) {
        z = keyBetween(z, null);
        const id = `c${c}-${i}`;
        ids.push(id);
        ops.push({ t: "put", shape: makeShape(rng, id, z) });
      } else {
        const id = pick(rng, ids);
        ops.push({ t: "patch", id, patch: { x: intBetween(rng, 0, 1000) } });
      }
    }
    clients.push({ client: c, ops });
  }
  return { id: `S2-concurrent-k${k}`, clients };
}

export function traceS3(seed: number, shapes = 5000): Trace {
  const rng = mulberry32(seed);
  const ops: Op[] = [];
  let z: string | null = null;
  for (let i = 0; i < shapes; i++) {
    z = keyBetween(z, null);
    ops.push({ t: "put", shape: makeShape(rng, `big-${i}`, z) });
  }
  return { id: "S3-large-doc", clients: [{ client: 0, ops }] };
}

export function traceS4(seed: number, opsPerClient = 300): Trace {
  return {
    ...traceS2(seed, 2, opsPerClient),
    id: "S4-offline-merge",
  };
}

export function traceS5(seed: number, ops_ = 800): Trace {
  const rng = mulberry32(seed);
  const ops: Op[] = [];
  let z: string | null = null;
  const live: ShapeId[] = [];
  for (let i = 0; i < ops_; i++) {
    const r = rng();
    if (live.length === 0 || r < 0.4) {
      z = keyBetween(z, null);
      const id = `h-${i}`;
      live.push(id);
      ops.push({ t: "put", shape: makeShape(rng, id, z) });
    } else if (r < 0.8) {
      const id = pick(rng, live);
      ops.push({
        t: "patch",
        id,
        patch: { x: intBetween(rng, 0, 1000), y: intBetween(rng, 0, 700) },
      });
    } else {
      const idx = intBetween(rng, 0, live.length);
      const id = live[idx]!;
      live.splice(idx, 1);
      ops.push({ t: "delete", id });
    }
  }
  return { id: "S5-high-churn", clients: [{ client: 0, ops }] };
}

export function traceS6(seed: number, edits = 400): Trace {
  const rng = mulberry32(seed);
  const ops: Op[] = [];
  let z: string | null = null;
  const ids: ShapeId[] = [];
  for (let i = 0; i < edits; i++) {
    if (ids.length === 0 || rng() < 0.1) {
      z = keyBetween(z, null);
      const id = `b-${i}`;
      ids.push(id);
      ops.push({ t: "put", shape: makeShape(rng, id, z) });
    } else {
      const id = pick(rng, ids);
      ops.push({ t: "patch", id, patch: { x: intBetween(rng, 0, 1000) } });
    }
  }
  return { id: "S6-batching", clients: [{ client: 0, ops }] };
}
