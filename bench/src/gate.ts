import type { CrdtBackend } from "@wb/crdt";
import type { Op } from "./traces.js";

export function applyOp(be: CrdtBackend, op: Op): void {
  switch (op.t) {
    case "put":
      be.putShape(op.shape);
      break;
    case "patch":
      be.patchShape(op.id, op.patch);
      break;
    case "delete":
      be.deleteShape(op.id);
      break;
  }
}

export interface GateResult {
  converged: boolean;
  byteIdentical: boolean;
  replicas: number;
  snapshotBytes: number;
  detail: string;
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export function checkConvergence(replicas: readonly CrdtBackend[]): GateResult {
  if (replicas.length === 0) {
    return {
      converged: false,
      byteIdentical: false,
      replicas: 0,
      snapshotBytes: 0,
      detail: "no replicas",
    };
  }

  const refShapes = JSON.stringify(replicas[0]!.getAllShapes());
  for (let i = 1; i < replicas.length; i++) {
    if (JSON.stringify(replicas[i]!.getAllShapes()) !== refShapes) {
      return {
        converged: false,
        byteIdentical: false,
        replicas: replicas.length,
        snapshotBytes: 0,
        detail: `replica ${i} logical state diverged`,
      };
    }
  }

  const ref = replicas[0]!.getSnapshot();
  let byteIdentical = true;
  for (let i = 1; i < replicas.length; i++) {
    if (!bytesEqual(ref, replicas[i]!.getSnapshot())) {
      byteIdentical = false;
      break;
    }
  }
  return {
    converged: true,
    byteIdentical,
    replicas: replicas.length,
    snapshotBytes: ref.length,
    detail: byteIdentical
      ? `all ${replicas.length} replicas converged, byte-identical (${ref.length}B)`
      : `all ${replicas.length} replicas converged logically; snapshot bytes non-canonical (${ref.length}B) — reported, not a gate failure`,
  };
}
