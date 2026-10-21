import type { Shape, ShapeId } from "./model.js";

export type Update = Uint8Array;
export type Snapshot = Uint8Array;

// app und benchmark kennen nur dieses gemeinsame interface
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

  wasmMemoryBytes?(): number | null;
}

export interface PresenceState {
  cursor?: { x: number; y: number };
  selection?: ShapeId[];
  name: string;
  color: string;
}

// presence bleibt absichtlich neben dem dokument
export interface PresenceChannel {
  setLocal(state: PresenceState): void;
  onRemote(cb: (peers: Map<string, PresenceState>) => void): void;
}
