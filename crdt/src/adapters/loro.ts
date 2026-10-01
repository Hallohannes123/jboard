import { LoroDoc, LoroMap, UndoManager } from "loro-crdt";
import type { CrdtBackend, Snapshot, Update } from "../backend.js";
import type { Shape, ShapeId, ShapeKind } from "../model.js";
import { byZ } from "../model.js";

const LOCAL = "local";

function writeShape(m: LoroMap, s: Shape): void {
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

function readShape(m: LoroMap): Shape {
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

export class LoroBackend implements CrdtBackend {
  readonly kind = "loro" as const;

  private doc: LoroDoc;
  private shapes: LoroMap;
  private undoMgr: UndoManager;

  constructor() {
    this.doc = new LoroDoc();
    this.shapes = this.doc.getMap("shapes");
    this.undoMgr = new UndoManager(this.doc, {
      excludeOriginPrefixes: ["remote"],
    });
  }

  load(snapshot?: Snapshot): void {
    if (snapshot !== undefined) this.doc.import(snapshot);
  }

  getSnapshot(): Snapshot {
    // offene änderungen vor dem export abschließen
    this.doc.commit();
    return this.doc.export({ mode: "snapshot" });
  }

  applyRemote(update: Update): void {
    this.doc.import(update);
  }

  onLocalUpdate(cb: (u: Update) => void): void {
    this.doc.subscribeLocalUpdates((bytes) => cb(bytes));
  }

  transact(fn: () => void): void {
    fn();
    this.doc.commit({ origin: LOCAL });
  }

  putShape(s: Shape): void {
    let m = this.shapes.get(s.id) as LoroMap | undefined;
    if (m === undefined) m = this.shapes.setContainer(s.id, new LoroMap());
    writeShape(m, s);
    this.doc.commit({ origin: LOCAL });
  }

  patchShape(id: ShapeId, patch: Partial<Shape>): void {
    const m = this.shapes.get(id) as LoroMap | undefined;
    if (m === undefined) return;
    for (const key of SCALAR_FIELDS) {
      const v = patch[key];
      if (v !== undefined) m.set(key, v);
    }
    if (patch.points !== undefined) m.set("points", patch.points.slice());
    this.doc.commit({ origin: LOCAL });
  }

  deleteShape(id: ShapeId): void {
    this.shapes.delete(id);
    this.doc.commit({ origin: LOCAL });
  }

  getShape(id: ShapeId): Shape | undefined {
    const m = this.shapes.get(id) as LoroMap | undefined;
    return m === undefined ? undefined : readShape(m);
  }

  getAllShapes(): Shape[] {
    // z bestimmt die zeichenreihenfolge
    const out: Shape[] = [];
    for (const key of this.shapes.keys()) {
      const m = this.shapes.get(key) as LoroMap | undefined;
      if (m !== undefined) out.push(readShape(m));
    }
    return out.sort(byZ);
  }

  undo(): void {
    this.undoMgr.undo();
  }

  redo(): void {
    this.undoMgr.redo();
  }

  subscribe(cb: () => void): () => void {
    return this.doc.subscribe(() => cb());
  }
}
