import type { Shape, ShapeId } from "./model.js";

// Transport und Bench kennen nur Bytes
export type Update = Uint8Array;
export type Snapshot = Uint8Array;

// gemeinsamer Einstieg für alle Backends
export interface CrdtBackend {
  readonly kind: "yjs" | "automerge" | "loro";

  load(snapshot?: Snapshot): void;
  getSnapshot(): Snapshot;

  applyRemote(update: Update): void;
  onLocalUpdate(cb: (u: Update) => void): void;
  transact(fn: () => void): void;

  putShape(s: Shape): void;
  patchShape(id: ShapeId, patch: Partial<Shape>): void;
  deleteShape(id: ShapeId): void;
  getShape(id: ShapeId): Shape | undefined;
  getAllShapes(): Shape[];

  undo(): void;
  redo(): void;
  subscribe(cb: () => void): () => void;
}

// Presence bleibt vom Dokument getrennt
export interface PresenceState {
  cursor?: { x: number; y: number };
  selection?: ShapeId[];
  name: string;
  color: string;
}

export interface PresenceChannel {
  setLocal(state: PresenceState): void;
  onRemote(cb: (peers: Map<string, PresenceState>) => void): void;
}
