import { next as A } from "@automerge/automerge";
import type { CrdtBackend, Snapshot, Update } from "../backend.js";
import type { Shape, ShapeId } from "../model.js";
import { byZ } from "../model.js";

const SEED_ACTOR = "0".repeat(16);

const ROOT_SEED: Snapshot = A.save(A.from<DocShape>({ shapes: {} }, SEED_ACTOR));

function compareBytes(a: Uint8Array, b: Uint8Array): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i]! !== b[i]!) return a[i]! - b[i]!;
  }
  return a.length - b.length;
}

function randomActor(): string {
  let s = "";
  for (let i = 0; i < 16; i++) {
    s += Math.floor(Math.random() * 256)
      .toString(16)
      .padStart(2, "0");
  }
  return s;
}

type ShapeRecord = {
  id: string;
  kind: string;
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
  z: string;
  fill: string;
  stroke: string;
  strokeWidth: number;
  points?: number[];
  text?: string;
};

type DocShape = { shapes: Record<string, ShapeRecord> };

const ALL_FIELDS = [
  "id",
  "kind",
  "x",
  "y",
  "w",
  "h",
  "rotation",
  "z",
  "fill",
  "stroke",
  "strokeWidth",
  "text",
  "points",
] as const;

type Touched = Map<string, Set<string> | "*">;
interface UndoFrame {
  source: A.Doc<DocShape>;
  touched: Touched;
}

function touchedPaths(doc: A.Doc<DocShape>, before: A.Heads, after: A.Heads): Touched {
  const touched: Touched = new Map();
  for (const patch of A.diff(doc, before, after)) {
    const [root, id, field] = patch.path;
    if (root !== "shapes" || typeof id !== "string") continue;
    if (field === undefined) {
      touched.set(id, "*");
      continue;
    }
    const cur = touched.get(id);
    if (cur === "*") continue;
    const set = cur ?? new Set<string>();
    set.add(String(field));
    touched.set(id, set);
  }
  return touched;
}

function cloneFields(src: ShapeRecord): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of ALL_FIELDS) {
    const v = (src as Record<string, unknown>)[f];
    if (v !== undefined) out[f] = Array.isArray(v) ? v.slice() : v;
  }
  return out;
}

function reconcileTouched(d: DocShape, source: DocShape, touched: Touched): void {
  for (const [id, fields] of touched) {
    const src = source.shapes[id];
    if (fields === "*") {
      if (src === undefined) delete d.shapes[id];
      else d.shapes[id] = cloneFields(src) as unknown as ShapeRecord;
      continue;
    }
    if (src === undefined) {
      delete d.shapes[id];
      continue;
    }
    let tgt = d.shapes[id];
    if (tgt === undefined) {
      tgt = cloneFields(src) as unknown as ShapeRecord;
      d.shapes[id] = tgt;
      continue;
    }
    const t = tgt as unknown as Record<string, unknown>;
    const s = src as unknown as Record<string, unknown>;
    for (const f of fields) {
      const v = s[f];
      if (v === undefined) delete t[f];
      else t[f] = Array.isArray(v) ? v.slice() : v;
    }
  }
}

function toRecord(s: Shape): ShapeRecord {
  const r: ShapeRecord = {
    id: s.id,
    kind: s.kind,
    x: s.x,
    y: s.y,
    w: s.w,
    h: s.h,
    rotation: s.rotation,
    z: s.z,
    fill: s.fill,
    stroke: s.stroke,
    strokeWidth: s.strokeWidth,
  };
  if (s.points !== undefined) r.points = s.points.slice();
  if (s.text !== undefined) r.text = s.text;
  return r;
}

function fromRecord(r: ShapeRecord): Shape {
  const shape: Shape = {
    id: r.id as ShapeId,
    kind: r.kind as Shape["kind"],
    x: r.x,
    y: r.y,
    w: r.w,
    h: r.h,
    rotation: r.rotation,
    z: r.z,
    fill: r.fill,
    stroke: r.stroke,
    strokeWidth: r.strokeWidth,
  };
  if (Array.isArray(r.points)) shape.points = r.points.slice();
  if (typeof r.text === "string") shape.text = r.text;
  return shape;
}

const SCALAR_FIELDS = [
  "kind",
  "x",
  "y",
  "w",
  "h",
  "rotation",
  "z",
  "fill",
  "stroke",
  "strokeWidth",
  "text",
] as const;

export const UNDO_LIMIT = 100;

export class AutomergeBackend implements CrdtBackend {
  readonly kind = "automerge" as const;

  private doc: A.Doc<DocShape>;
  private localCb?: (u: Update) => void;
  private changeCbs = new Set<() => void>();

  private undoStack: UndoFrame[] = [];
  private redoStack: UndoFrame[] = [];

  private txnFns: A.ChangeFn<DocShape>[] | null = null;

  constructor() {
    this.doc = A.load<DocShape>(ROOT_SEED, randomActor());
  }

  load(snapshot?: Snapshot): void {
    if (snapshot !== undefined) {
      this.doc = A.load<DocShape>(snapshot, randomActor());
      this.undoStack = [];
      this.redoStack = [];

      this.fireChange();
    }
  }

  getSnapshot(): Snapshot {
    const changes = A.getAllChanges(this.doc)
      .slice()
      .sort((x, y) => compareBytes(x, y));
    let canon = A.init<DocShape>(SEED_ACTOR);
    [canon] = A.applyChanges(canon, changes);
    return A.save(canon);
  }

  applyRemote(update: Update): void {
    try {
      [this.doc] = A.applyChanges(this.doc, [update]);
    } catch {
      this.doc = A.merge(this.doc, A.load<DocShape>(update, randomActor()));
    }
    this.fireChange();
  }

  onLocalUpdate(cb: (u: Update) => void): void {
    this.localCb = cb;
  }

  transact(fn: () => void): void {
    if (this.txnFns !== null) {
      fn();
      return;
    }
    const batch: A.ChangeFn<DocShape>[] = [];
    this.txnFns = batch;
    try {
      fn();
    } finally {
      this.txnFns = null;
    }
    if (batch.length === 0) return;
    this.commit((d) => {
      for (const change of batch) change(d);
    });
  }

  private mutate(fn: A.ChangeFn<DocShape>): void {
    if (this.txnFns !== null) {
      this.txnFns.push(fn);
      return;
    }
    this.commit(fn);
  }

  private commit(fn: A.ChangeFn<DocShape>): void {
    const before = this.doc;
    const beforeHeads = A.getHeads(before);
    const next = A.change(before, fn);
    const touched = touchedPaths(next, beforeHeads, A.getHeads(next));

    if (touched.size === 0) {
      this.doc = next;
      return;
    }
    this.pushBounded(this.undoStack, { source: before, touched });
    this.redoStack = [];
    this.doc = next;
    this.emitDelta();
    this.fireChange();
  }

  private pushBounded(stack: UndoFrame[], frame: UndoFrame): void {
    stack.push(frame);
    if (stack.length > UNDO_LIMIT) stack.shift();
  }

  private emitDelta(): void {
    if (this.localCb === undefined) return;

    const delta = A.getLastLocalChange(this.doc);
    if (delta !== undefined) this.localCb(delta);
  }

  putShape(s: Shape): void {
    const rec = toRecord(s);
    this.mutate((d) => {
      const existing = d.shapes[s.id];
      if (existing === undefined) {
        d.shapes[s.id] = rec;
        return;
      }

      const target = existing;
      for (const key of SCALAR_FIELDS) {
        const v = rec[key];
        if (v !== undefined) (target as Record<string, unknown>)[key] = v;
        else if (target[key] !== undefined) delete (target as Record<string, unknown>)[key];
      }
      if (rec.points !== undefined) target.points = rec.points.slice();
      else if (target.points !== undefined) delete target.points;
    });
  }

  patchShape(id: ShapeId, patch: Partial<Shape>): void {
    if (this.txnFns === null && this.doc.shapes[id] === undefined) return;
    this.mutate((d) => {
      const target = d.shapes[id];
      if (target === undefined) return;
      for (const key of SCALAR_FIELDS) {
        const v = patch[key];
        if (v !== undefined) (target as Record<string, unknown>)[key] = v;
      }
      if (patch.points !== undefined) target.points = patch.points.slice();
    });
  }

  deleteShape(id: ShapeId): void {
    if (this.txnFns === null && this.doc.shapes[id] === undefined) return;
    this.mutate((d) => {
      if (d.shapes[id] === undefined) return;
      delete d.shapes[id];
    });
  }

  getShape(id: ShapeId): Shape | undefined {
    const r = this.doc.shapes[id];
    return r === undefined ? undefined : fromRecord(r);
  }

  getAllShapes(): Shape[] {
    return Object.values(this.doc.shapes).map(fromRecord).sort(byZ);
  }

  undo(): void {
    const frame = this.undoStack.pop();
    if (frame === undefined) return;
    this.reconcileFrame(frame, this.redoStack);
  }

  redo(): void {
    const frame = this.redoStack.pop();
    if (frame === undefined) return;
    this.reconcileFrame(frame, this.undoStack);
  }

  private reconcileFrame(frame: UndoFrame, inverseStack: UndoFrame[]): void {
    const before = this.doc;
    const beforeHeads = A.getHeads(before);
    const next = A.change(before, (d) => reconcileTouched(d, frame.source, frame.touched));
    const touched = touchedPaths(next, beforeHeads, A.getHeads(next));
    this.pushBounded(inverseStack, { source: before, touched: frame.touched });
    this.doc = next;
    if (touched.size === 0) return;
    this.emitDelta();
    this.fireChange();
  }

  subscribe(cb: () => void): () => void {
    this.changeCbs.add(cb);
    return () => this.changeCbs.delete(cb);
  }

  wasmMemoryBytes(): number | null {
    return null;
  }

  private fireChange(): void {
    for (const cb of this.changeCbs) cb();
  }
}
