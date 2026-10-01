import * as Y from "yjs";
import type { CrdtBackend, Snapshot, Update } from "../backend.js";
import type { Shape, ShapeId, ShapeKind } from "../model.js";
import { byZ } from "../model.js";

// eigene und empfangene änderungen getrennt halten
const LOCAL = Symbol("local");
const REMOTE = Symbol("remote");

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

function writeShape(m: Y.Map<unknown>, s: Shape): void {
  m.set("id", s.id);
  m.set("kind", s.kind);
  m.set("x", s.x);
  m.set("y", s.y);
  m.set("w", s.w);
  m.set("h", s.h);
  m.set("rotation", s.rotation);
  m.set("z", s.z);
  m.set("fill", s.fill);
  m.set("stroke", s.stroke);
  m.set("strokeWidth", s.strokeWidth);
  if (s.points !== undefined) m.set("points", s.points.slice());
  if (s.text !== undefined) m.set("text", s.text);
}

function readShape(m: Y.Map<unknown>): Shape {
  const shape: Shape = {
    id: m.get("id") as ShapeId,
    kind: m.get("kind") as ShapeKind,
    x: m.get("x") as number,
    y: m.get("y") as number,
    w: m.get("w") as number,
    h: m.get("h") as number,
    rotation: m.get("rotation") as number,
    z: m.get("z") as string,
    fill: m.get("fill") as string,
    stroke: m.get("stroke") as string,
    strokeWidth: m.get("strokeWidth") as number,
  };
  const points = m.get("points");
  if (Array.isArray(points)) shape.points = (points as number[]).slice();
  const text = m.get("text");
  if (typeof text === "string") shape.text = text;
  return shape;
}

export class YjsBackend implements CrdtBackend {
  readonly kind = "yjs" as const;

  private doc: Y.Doc;
  private shapes: Y.Map<Y.Map<unknown>>;
  private undoMgr: Y.UndoManager;

  constructor() {
    this.doc = new Y.Doc();
    this.shapes = this.doc.getMap<Y.Map<unknown>>("shapes");
    this.undoMgr = new Y.UndoManager(this.shapes, {
      trackedOrigins: new Set([LOCAL]),
      captureTimeout: 0,
    });
  }

  load(snapshot?: Snapshot): void {
    if (snapshot !== undefined) {
      Y.applyUpdate(this.doc, snapshot, REMOTE);
    }
  }

  getSnapshot(): Snapshot {
    // frisches dokument für den snapshot
    const fresh = new Y.Doc();
    Y.applyUpdate(fresh, Y.encodeStateAsUpdate(this.doc));
    return Y.encodeStateAsUpdate(fresh);
  }

  applyRemote(update: Update): void {
    Y.applyUpdate(this.doc, update, REMOTE);
  }

  onLocalUpdate(cb: (u: Update) => void): void {
    this.doc.on("update", (update: Uint8Array, origin: unknown) => {
      if (origin !== REMOTE) cb(update);
    });
  }

  transact(fn: () => void): void {
    this.doc.transact(fn, LOCAL);
  }

  putShape(s: Shape): void {
    this.doc.transact(() => {
      let m = this.shapes.get(s.id);
      if (m === undefined) {
        m = new Y.Map();
        this.shapes.set(s.id, m);
      }
      writeShape(m, s);
    }, LOCAL);
  }

  patchShape(id: ShapeId, patch: Partial<Shape>): void {
    const m = this.shapes.get(id);
    if (m === undefined) return;
    this.doc.transact(() => {
      for (const key of SCALAR_FIELDS) {
        const v = patch[key];
        if (v !== undefined) m.set(key, v);
      }
      if (patch.points !== undefined) m.set("points", patch.points.slice());
    }, LOCAL);
  }

  deleteShape(id: ShapeId): void {
    this.doc.transact(() => {
      this.shapes.delete(id);
    }, LOCAL);
  }

  getShape(id: ShapeId): Shape | undefined {
    const m = this.shapes.get(id);
    return m === undefined ? undefined : readShape(m);
  }

  getAllShapes(): Shape[] {
    // z bestimmt die zeichenreihenfolge
    const out: Shape[] = [];
    this.shapes.forEach((m) => out.push(readShape(m)));
    return out.sort(byZ);
  }

  undo(): void {
    this.undoMgr.undo();
  }

  redo(): void {
    this.undoMgr.redo();
  }

  subscribe(cb: () => void): () => void {
    const handler = (): void => cb();
    this.shapes.observeDeep(handler);
    return () => this.shapes.unobserveDeep(handler);
  }
}
