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

export class AutomergeBackend implements CrdtBackend {
  readonly kind = "automerge" as const;

  private doc: A.Doc<DocShape>;
  private localCb?: (u: Update) => void;
  private changeCbs = new Set<() => void>();

  // eigene stacks, weil automerge kein undo mitbringt
  private undoStack: A.Doc<DocShape>[] = [];
  private redoStack: A.Doc<DocShape>[] = [];

  constructor() {
    this.doc = A.load<DocShape>(ROOT_SEED, randomActor());
  }

  load(snapshot?: Snapshot): void {
    if (snapshot !== undefined) this.doc = A.load<DocShape>(snapshot, randomActor());
  }

  getSnapshot(): Snapshot {
    // änderungen für den snapshot sortiert nachspielen
    const changes = A.getAllChanges(this.doc)
      .slice()
      .sort((x, y) => compareBytes(x, y));
    let canon = A.init<DocShape>(SEED_ACTOR);
    [canon] = A.applyChanges(canon, changes);
    return A.save(canon);
  }

  applyRemote(update: Update): void {
    [this.doc] = A.applyChanges(this.doc, [update]);
    this.fireChange();
  }

  onLocalUpdate(cb: (u: Update) => void): void {
    this.localCb = cb;
  }

  transact(fn: () => void): void {
    fn();
  }

  private mutate(fn: A.ChangeFn<DocShape>): void {
    this.undoStack.push(this.doc);
    this.redoStack = [];
    this.doc = A.change(this.doc, fn);
    this.emitDelta();
    this.fireChange();
  }

  private emitDelta(): void {
    if (this.localCb === undefined) return;
    const delta = A.getLastLocalChange(this.doc);
    if (delta !== undefined) this.localCb(delta);
  }

  putShape(s: Shape): void {
    const rec = toRecord(s);
    this.mutate((d) => {
      d.shapes[s.id] = rec;
    });
  }

  patchShape(id: ShapeId, patch: Partial<Shape>): void {
    if (this.doc.shapes[id] === undefined) return;
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
    if (this.doc.shapes[id] === undefined) return;
    this.mutate((d) => {
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
    const prev = this.undoStack.pop();
    if (prev === undefined) return;
    this.redoStack.push(this.doc);
    this.doc = A.change(this.doc, (d) => {
      for (const id of Object.keys(d.shapes)) {
        if (prev.shapes[id] === undefined) delete d.shapes[id];
      }
      for (const [id, rec] of Object.entries(prev.shapes)) {
        d.shapes[id] = { ...rec };
      }
    });
    this.emitDelta();
    this.fireChange();
  }

  redo(): void {
    const next = this.redoStack.pop();
    if (next === undefined) return;
    this.undoStack.push(this.doc);
    this.doc = A.change(this.doc, (d) => {
      for (const id of Object.keys(d.shapes)) {
        if (next.shapes[id] === undefined) delete d.shapes[id];
      }
      for (const [id, rec] of Object.entries(next.shapes)) {
        d.shapes[id] = { ...rec };
      }
    });
    this.emitDelta();
    this.fireChange();
  }

  subscribe(cb: () => void): () => void {
    this.changeCbs.add(cb);
    return () => this.changeCbs.delete(cb);
  }

  private fireChange(): void {
    for (const cb of this.changeCbs) cb();
  }
}
