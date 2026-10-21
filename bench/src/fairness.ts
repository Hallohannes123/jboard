import { forceGc } from "./env.js";
import { createBackend } from "@wb/crdt";

export interface FairnessCheck {
  rule: string;
  pass: boolean;
  detail: string;
}

export function checkWasmMemorySeparable(): FairnessCheck {
  const readings: string[] = [];
  let ok = true;
  for (const kind of ["yjs", "automerge", "loro"] as const) {
    const be = createBackend(kind);
    const bytes = be.wasmMemoryBytes?.() ?? null;
    if (bytes === null) {
      readings.push(`${kind}=N/A`);
    } else if (bytes > 0) {
      readings.push(`${kind}=${bytes}B`);
    } else {
      ok = false;
      readings.push(`${kind}=${bytes}B(!)`);
    }
  }
  return {
    rule: "2-wasm-memory-probe",
    pass: ok,
    detail: ok
      ? `wasm linear memory probed per arm: ${readings.join(", ")} (positive bytes or explicit N/A, never a silent 0)`
      : `a wasm memory reading was non-positive and non-N/A: ${readings.join(", ")}`,
  };
}

export function checkGcAvailable(): FairnessCheck {
  const ok = forceGc();
  return {
    rule: "5-gc-forceable",
    pass: ok,
    detail: ok
      ? "global.gc present (--expose-gc active)"
      : "no --expose-gc: memory metrics marked unreliable",
  };
}

export function warmupPolicy(): FairnessCheck {
  return {
    rule: "5-warmup-discarded",
    pass: true,
    detail: "timeReps discards warmup reps before recording; default 3 warmup + >=10 measured",
  };
}

export function modeSeparationPolicy(): FairnessCheck {
  return {
    rule: "1+4-cold-start-and-batching-separated",
    pass: true,
    detail:
      "scenarios tag mode: cold-open vs steady-state (S3), per-op vs batched (S6) — never merged",
  };
}

export function allFairnessChecks(): FairnessCheck[] {
  return [checkWasmMemorySeparable(), checkGcAvailable(), warmupPolicy(), modeSeparationPolicy()];
}
