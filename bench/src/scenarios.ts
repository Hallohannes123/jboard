import type { CrdtBackend } from "@wb/crdt";
import { createBackend } from "@wb/crdt";
import type { Op, Trace } from "./traces.js";
import { traceS1, traceS2, traceS3, traceS4, traceS5, traceS6 } from "./traces.js";
import { applyOp, checkConvergence } from "./gate.js";
import {
  excluded,
  measureMemDelta,
  notApplicable,
  summarize,
  timeReps,
  type MetricResult,
} from "./metrics.js";
import { isWasmBacked, libVersion } from "./versions.js";

export type Kind = "yjs" | "automerge" | "loro";

const SEED = 0x513e;

function base(
  kind: Kind,
  scenario: string,
  metric: string,
  unit: string,
  mode: string,
  k: number | null,
  converged: boolean,
  note = "",
): Omit<MetricResult, "median" | "mad" | "p95" | "ci95" | "reps" | "samples"> {
  return {
    library: kind,
    version: libVersion(kind),
    scenario,
    k,
    metric,
    unit,
    mode,
    converged,

    byteIdentical: true,
    wasmBacked: isWasmBacked(kind),
    warmupDiscarded: 3,
    note,
  };
}

function tagByteIdentical(records: MetricResult[], byteIdentical: boolean): MetricResult[] {
  for (const r of records) r.byteIdentical = byteIdentical;
  return records;
}

function replayCollectingSizes(kind: Kind, ops: Op[]): { be: CrdtBackend; sizes: number[] } {
  const be = createBackend(kind);
  const sizes: number[] = [];
  be.onLocalUpdate((u) => sizes.push(u.byteLength));
  for (const op of ops) applyOp(be, op);
  return { be, sizes };
}

export function runS1(kind: Kind): MetricResult[] {
  const trace = traceS1(SEED);
  const ops = trace.clients[0]!.ops;
  const out: MetricResult[] = [];

  const { be, sizes } = replayCollectingSizes(kind, ops);
  const fresh = createBackend(kind);
  fresh.load(be.getSnapshot());
  const gate = checkConvergence([be, fresh]);
  logGate(trace.id, kind, gate);

  if (!gate.converged) {
    return [
      excluded(
        base(kind, trace.id, "localApplyMs", "ms", "steady-state", null, false, gate.detail),
      ),
    ];
  }

  const apply = timeReps(
    () => {},
    () => {
      const r = createBackend(kind);
      for (const op of ops) applyOp(r, op);
    },
  );
  out.push(
    summarize(base(kind, trace.id, "localApplyMs", "ms", "steady-state", null, true), apply),
  );
  out.push(summarize(base(kind, trace.id, "updateSizeB", "bytes/op", "per-op", null, true), sizes));
  out.push(
    summarize(base(kind, trace.id, "docSizeB", "bytes", "canonical-snapshot", null, true), [
      gate.snapshotBytes,
    ]),
  );
  return tagByteIdentical(out, gate.byteIdentical);
}

export function runS2(kind: Kind, k: number): MetricResult[] {
  const opsPerClient = Math.max(20, Math.round(1000 / k));
  const trace = traceS2(SEED, k, opsPerClient);
  const out: MetricResult[] = [];

  const gate = replayConcurrent(kind, trace);
  logGate(trace.id, kind, gate);
  if (!gate.converged) {
    return [
      excluded(base(kind, trace.id, "mergeTimeMs", "ms", "concurrent", k, false, gate.detail)),
    ];
  }

  const updates = collectAllUpdates(kind, trace);
  const totalBytes = updates.reduce((n, u) => n + u.byteLength, 0);
  const merge = timeReps(
    () => {},
    () => {
      const r = createBackend(kind);
      for (const u of updates) r.applyRemote(u);
    },
  );
  out.push(summarize(base(kind, trace.id, "mergeTimeMs", "ms", "concurrent", k, true), merge));
  out.push(
    summarize(base(kind, trace.id, "syncBytesB", "bytes", "incremental", k, true), [totalBytes]),
  );
  out.push(
    summarize(
      base(kind, trace.id, "updateSizeB", "bytes/op", "per-op", k, true),
      updates.map((u) => u.byteLength),
    ),
  );
  out.push(
    summarize(base(kind, trace.id, "docSizeB", "bytes", "canonical-snapshot", k, true), [
      gate.snapshotBytes,
    ]),
  );
  return tagByteIdentical(out, gate.byteIdentical);
}

export function runS3(kind: Kind): MetricResult[] {
  const trace = traceS3(SEED);
  const ops = trace.clients[0]!.ops;
  const out: MetricResult[] = [];

  const source = createBackend(kind);
  for (const op of ops) applyOp(source, op);
  const snapshot = source.getSnapshot();

  const loaded = createBackend(kind);
  loaded.load(snapshot);
  const gate = checkConvergence([source, loaded]);
  logGate(trace.id, kind, gate);
  if (!gate.converged) {
    return [
      excluded(base(kind, trace.id, "loadTimeMs", "ms", "cold-open", null, false, gate.detail)),
    ];
  }

  const load = timeReps(
    () => {},
    () => {
      const r = createBackend(kind);
      r.load(snapshot);
      r.getAllShapes();
    },
  );
  out.push(summarize(base(kind, trace.id, "loadTimeMs", "ms", "cold-open", null, true), load));
  out.push(
    summarize(base(kind, trace.id, "fullSyncBytesB", "bytes", "cold-open", null, true), [
      snapshot.byteLength,
    ]),
  );
  out.push(
    summarize(base(kind, trace.id, "docSizeB", "bytes", "canonical-snapshot", null, true), [
      gate.snapshotBytes,
    ]),
  );

  const beMem = createBackend(kind);
  beMem.load(snapshot);
  beMem.getAllShapes();
  const wasmBytes = beMem.wasmMemoryBytes?.() ?? null;
  if (wasmBytes === null) {
    out.push(
      notApplicable(
        base(
          kind,
          trace.id,
          "memWasmBytesB",
          "bytes",
          "steady-state",
          null,
          true,
          isWasmBacked(kind)
            ? "wasm-backed but no readable memory handle — reported N/A, not fabricated"
            : "pure-js arm — no wasm linear memory; see memHeapUsedB",
        ),
      ),
    );
  } else {
    out.push(
      summarize(
        base(
          kind,
          trace.id,
          "memWasmBytesB",
          "bytes",
          "steady-state",
          null,
          true,
          "wasm linear memory (absolute, process-cumulative — shared across docs, only grows)",
        ),
        [wasmBytes],
      ),
    );
  }

  const mem = measureMemDelta(
    () => {},
    () => {
      const held: CrdtBackend[] = [];

      for (let i = 0; i < 5; i++) {
        const r = createBackend(kind);
        r.load(snapshot);
        r.getAllShapes();
        held.push(r);
      }

      if (held.length < 0) throw new Error("unreachable");
    },
  );
  if (mem === null) {
    out.push(
      notApplicable(
        base(
          kind,
          trace.id,
          "memHeapUsedB",
          "bytes",
          "steady-state",
          null,
          true,
          "no --expose-gc: memory unreliable",
        ),
      ),
    );
  } else {
    out.push(
      summarize(
        base(
          kind,
          trace.id,
          "memHeapUsedB",
          "bytes",
          "steady-state",
          null,
          true,
          "js heap only — misses wasm (per-doc delta over 5 loads)",
        ),
        [Math.max(0, mem.heapUsedB) / 5],
      ),
    );
  }

  const plaintextB = Buffer.byteLength(JSON.stringify(loaded.getAllShapes()), "utf8");
  out.push(
    summarize(
      base(
        kind,
        trace.id,
        "docOverheadRatio",
        "ratio",
        "canonical-snapshot",
        null,
        true,
        "encoded snapshot / plaintext-json of same shapes; read with the history model (automerge retains full history)",
      ),
      [gate.snapshotBytes / plaintextB],
    ),
  );

  const peakBe = createBackend(kind);
  for (const op of ops) applyOp(peakBe, op);
  const peakWasm = peakBe.wasmMemoryBytes?.() ?? null;
  if (peakWasm === null) {
    out.push(
      notApplicable(
        base(
          kind,
          trace.id,
          "memWasmPeakB",
          "bytes",
          "peak",
          null,
          true,
          isWasmBacked(kind)
            ? "wasm-backed but no readable memory handle — peak N/A, not fabricated"
            : "pure-js arm — no wasm linear memory to peak",
        ),
      ),
    );
  } else {
    out.push(
      summarize(
        base(
          kind,
          trace.id,
          "memWasmPeakB",
          "bytes",
          "peak",
          null,
          true,
          "peak wasm linear memory after authoring the large doc (monotonic within a process)",
        ),
        [peakWasm],
      ),
    );
  }

  return tagByteIdentical(out, gate.byteIdentical);
}

export function runS4(kind: Kind): MetricResult[] {
  const trace = traceS4(SEED);
  const aOps = trace.clients[0]!.ops;
  const bOps = trace.clients[1]!.ops;
  const out: MetricResult[] = [];

  const a = createBackend(kind);
  const b = createBackend(kind);
  const toB: Uint8Array[] = [];
  const toA: Uint8Array[] = [];
  a.onLocalUpdate((u) => toB.push(u));
  b.onLocalUpdate((u) => toA.push(u));
  for (const op of aOps) applyOp(a, op);
  for (const op of bOps) applyOp(b, op);
  const catchUpBytes =
    toB.reduce((n, u) => n + u.byteLength, 0) + toA.reduce((n, u) => n + u.byteLength, 0);
  for (const u of toB) b.applyRemote(u);
  for (const u of toA) a.applyRemote(u);

  const gate = checkConvergence([a, b]);
  logGate(trace.id, kind, gate);
  if (!gate.converged) {
    return [
      excluded(
        base(kind, trace.id, "reconcileTimeMs", "ms", "offline-merge", 2, false, gate.detail),
      ),
    ];
  }

  const reconcile = timeReps(
    () => {},
    () => {
      const r = createBackend(kind);
      for (const u of toB) r.applyRemote(u);
      for (const u of toA) r.applyRemote(u);
    },
  );
  out.push(
    summarize(base(kind, trace.id, "reconcileTimeMs", "ms", "offline-merge", 2, true), reconcile),
  );
  out.push(
    summarize(base(kind, trace.id, "catchUpBytesB", "bytes", "offline-merge", 2, true), [
      catchUpBytes,
    ]),
  );
  out.push(
    summarize(base(kind, trace.id, "docSizeB", "bytes", "canonical-snapshot", 2, true), [
      gate.snapshotBytes,
    ]),
  );
  return tagByteIdentical(out, gate.byteIdentical);
}

export function runS5(kind: Kind): MetricResult[] {
  const trace = traceS5(SEED);
  const ops = trace.clients[0]!.ops;
  const out: MetricResult[] = [];

  const { be, sizes } = replayCollectingSizes(kind, ops);
  const fresh = createBackend(kind);
  fresh.load(be.getSnapshot());
  const gate = checkConvergence([be, fresh]);
  logGate(trace.id, kind, gate);
  if (!gate.converged) {
    return [
      excluded(
        base(kind, trace.id, "localApplyMs", "ms", "steady-state", null, false, gate.detail),
      ),
    ];
  }

  const apply = timeReps(
    () => {},
    () => {
      const r = createBackend(kind);
      for (const op of ops) applyOp(r, op);
    },
  );
  out.push(
    summarize(base(kind, trace.id, "localApplyMs", "ms", "steady-state", null, true), apply),
  );
  out.push(summarize(base(kind, trace.id, "updateSizeB", "bytes/op", "per-op", null, true), sizes));

  out.push(
    summarize(
      base(
        kind,
        trace.id,
        "docSizeB",
        "bytes",
        "canonical-snapshot",
        null,
        true,
        "post-churn size — reflects each library's tombstone/history model",
      ),
      [gate.snapshotBytes],
    ),
  );
  return tagByteIdentical(out, gate.byteIdentical);
}

export function runS6(kind: Kind): MetricResult[] {
  const trace = traceS6(SEED);
  const ops = trace.clients[0]!.ops;
  const out: MetricResult[] = [];

  const perOp = replayCollectingSizes(kind, ops);

  const batched = createBackend(kind);
  const batchSizes: number[] = [];
  batched.onLocalUpdate((u) => batchSizes.push(u.byteLength));
  batched.transact(() => {
    for (const op of ops) applyOp(batched, op);
  });

  const g1 = checkConvergence([perOp.be, cloneVia(kind, perOp.be)]);
  const g2 = checkConvergence([batched, cloneVia(kind, batched)]);
  logGate(trace.id + " per-op", kind, g1);
  logGate(trace.id + " batched", kind, g2);
  if (!g1.converged || !g2.converged) {
    return [
      excluded(
        base(
          kind,
          trace.id,
          "updateSizeB",
          "bytes/op",
          "per-op",
          null,
          false,
          `${g1.detail} | ${g2.detail}`,
        ),
      ),
    ];
  }

  const perOpTotal = perOp.sizes.reduce((n, s) => n + s, 0);
  const batchedTotal = batchSizes.reduce((n, s) => n + s, 0);
  out.push(
    summarize(
      base(
        kind,
        trace.id,
        "updateSizeB",
        "bytes/op",
        "per-op",
        null,
        true,
        `${perOp.sizes.length} updates`,
      ),
      perOp.sizes,
    ),
  );
  out.push(
    summarize(
      base(
        kind,
        trace.id,
        "updateSizeB",
        "bytes/op",
        "batched",
        null,
        true,
        `${batchSizes.length} updates`,
      ),
      batchSizes.length > 0 ? batchSizes : [0],
    ),
  );
  out.push(
    summarize(
      base(
        kind,
        trace.id,
        "syncBytesB",
        "bytes",
        "per-op",
        null,
        true,
        `${perOp.sizes.length} updates`,
      ),
      [perOpTotal],
    ),
  );
  out.push(
    summarize(
      base(
        kind,
        trace.id,
        "syncBytesB",
        "bytes",
        "batched",
        null,
        true,
        `${batchSizes.length} updates`,
      ),
      [batchedTotal],
    ),
  );
  return tagByteIdentical(out, g1.byteIdentical && g2.byteIdentical);
}

function cloneVia(kind: Kind, src: CrdtBackend): CrdtBackend {
  const dst = createBackend(kind);
  dst.load(src.getSnapshot());
  return dst;
}

function replayConcurrent(kind: Kind, trace: Trace): ReturnType<typeof checkConvergence> {
  const updates = collectAllUpdates(kind, trace);

  const forward = createBackend(kind);
  for (const u of updates) forward.applyRemote(u);

  const reverse = createBackend(kind);
  for (const u of [...updates].reverse()) reverse.applyRemote(u);

  const interleaved = createBackend(kind);
  const stride = Math.max(1, trace.clients.length);
  for (let off = 0; off < stride; off++) {
    for (let i = off; i < updates.length; i += stride) interleaved.applyRemote(updates[i]!);
  }

  return checkConvergence([forward, reverse, interleaved]);
}

function collectAllUpdates(kind: Kind, trace: Trace): Uint8Array[] {
  const updates: Uint8Array[] = [];
  for (const client of trace.clients) {
    const be = createBackend(kind);
    be.onLocalUpdate((u) => updates.push(u));
    for (const op of client.ops) applyOp(be, op);
  }
  return updates;
}

function logGate(scenario: string, kind: Kind, gate: ReturnType<typeof checkConvergence>): void {
  console.log(`[gate] ${scenario} / ${kind}: ${gate.detail}`);
}
