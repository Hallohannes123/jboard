import { describe, expect, it } from "vitest";
import {
  allFairnessChecks,
  checkWasmMemorySeparable,
  modeSeparationPolicy,
} from "../src/fairness.js";
import { timeReps, summarize, notApplicable, excluded, type MetricResult } from "../src/metrics.js";
import { runS3, runS6 } from "../src/scenarios.js";
import { checkConvergence } from "../src/gate.js";
import { libVersion } from "../src/versions.js";
import { createBackend, keyBetween, type Shape } from "@wb/crdt";
import { bootstrapMedianCi, median } from "../src/stats.js";

describe("fairness rules", () => {
  it("probes WASM linear memory for real per arm — positive bytes or explicit N/A (rule 2)", () => {
    const c = checkWasmMemorySeparable();
    expect(c.pass).toBe(true);

    expect(c.detail).toContain("loro=");
    expect(c.detail).toMatch(/loro=\d+B/);
    expect(c.detail).toContain("yjs=N/A");
    expect(c.detail).toContain("automerge=N/A");
  });

  it("timeReps discards warm-up reps before recording (rule 5)", () => {
    let calls = 0;
    const samples = timeReps(
      () => {},
      () => {
        calls++;
      },
      { reps: 10, warmup: 4 },
    );

    expect(calls).toBe(14);
    expect(samples.length).toBe(10);
  });

  it("separates cold-open from steady-state modes (rule 1)", () => {
    const records = runS3("yjs");
    const modes = new Set(records.map((r) => r.mode));
    expect(modes.has("cold-open")).toBe(true);
    expect(records.some((r) => r.mode === "steady-state")).toBe(true);
  });

  it("reports both per-op and batched modes for S6 (rule 4)", () => {
    const records = runS6("loro");
    const modes = new Set(records.map((r) => r.mode));
    expect(modes.has("per-op")).toBe(true);
    expect(modes.has("batched")).toBe(true);
  });

  it("all documented fairness checks pass or warn honestly", () => {
    const checks = allFairnessChecks();

    expect(checks.length).toBeGreaterThanOrEqual(4);
    expect(modeSeparationPolicy().pass).toBe(true);
  });

  it("resolves the real installed version of every arm (provenance)", () => {
    for (const kind of ["yjs", "automerge", "loro"] as const) {
      const v = libVersion(kind);
      expect(v).not.toBe("unresolved");
      expect(v).toMatch(/^\d+\.\d+\.\d+/);
    }
  });
});

describe("correctness gate precedes timing", () => {
  function shape(id: string, z: string): Shape {
    return {
      id,
      kind: "rect",
      x: 0,
      y: 0,
      w: 1,
      h: 1,
      rotation: 0,
      z,
      fill: "#000",
      stroke: "#000",
      strokeWidth: 1,
    };
  }

  it("flags divergence when replicas are not synced", () => {
    const a = createBackend("yjs");
    const b = createBackend("yjs");
    a.putShape(shape("a", keyBetween(null, null)));
    b.putShape(shape("b", keyBetween(null, null)));

    const gate = checkConvergence([a, b]);
    expect(gate.converged).toBe(false);
  });

  it("passes once replicas converge to byte-identical state", () => {
    const a = createBackend("yjs");
    const b = createBackend("yjs");
    a.onLocalUpdate((u) => b.applyRemote(u));
    b.onLocalUpdate((u) => a.applyRemote(u));
    a.putShape(shape("a", keyBetween(null, null)));
    b.putShape(shape("b", keyBetween(null, null)));
    const gate = checkConvergence([a, b]);
    expect(gate.converged).toBe(true);
    expect(gate.snapshotBytes).toBeGreaterThan(0);
  });

  it("gates on logical convergence but still records byte-identity as an observation", () => {
    const clientUpdates = (cid: number, n: number): Uint8Array[] => {
      const be = createBackend("loro");
      const us: Uint8Array[] = [];
      be.onLocalUpdate((u) => us.push(u));
      let z: string | null = null;
      for (let i = 0; i < n; i++) {
        z = keyBetween(z, null);
        be.putShape(shape(`c${cid}-${i}`, z));
        be.patchShape(`c${cid}-${i}`, { x: i });
      }
      return us;
    };
    const all = [...clientUpdates(0, 40), ...clientUpdates(1, 40)];
    const fwd = createBackend("loro");
    for (const u of all) fwd.applyRemote(u);
    const rev = createBackend("loro");
    for (const u of [...all].reverse()) rev.applyRemote(u);

    const gate = checkConvergence([fwd, rev]);

    expect(gate.converged).toBe(true);

    expect(fwd.getAllShapes()).toEqual(rev.getAllShapes());

    expect(typeof gate.byteIdentical).toBe("boolean");
  });

  it("records an unavailable metric as N/A (converged), distinct from a gate failure", () => {
    const b = {
      library: "automerge" as const,
      version: "test",
      scenario: "S3",
      k: null,
      metric: "memWasmBytesB",
      unit: "bytes",
      mode: "steady-state",
      converged: true,
      byteIdentical: true,
      wasmBacked: true,
      warmupDiscarded: 0,
      note: "no readable wasm handle",
    };
    const na = notApplicable(b);
    expect(na.converged).toBe(true);
    expect(Number.isNaN(na.median)).toBe(true);
    expect(na.samples).toEqual([]);

    const ex = excluded(b);
    expect(ex.converged).toBe(false);
    expect(Number.isNaN(ex.median)).toBe(true);
  });

  it("the wasm-memory probe is consistent with each arm's backing", () => {
    expect(createBackend("loro").wasmMemoryBytes?.() ?? 0).toBeGreaterThan(0);
    expect(createBackend("yjs").wasmMemoryBytes?.() ?? null).toBeNull();
    expect(createBackend("automerge").wasmMemoryBytes?.() ?? null).toBeNull();
  });
});

describe("stats", () => {
  it("median and bootstrap CI are deterministic and bracket the median", () => {
    const xs = [5, 1, 3, 2, 4, 6, 8, 7, 9, 10];
    const m = median(xs);
    expect(m).toBe(5.5);
    const ci1 = bootstrapMedianCi(xs, { seed: 42 });
    const ci2 = bootstrapMedianCi(xs, { seed: 42 });

    expect(ci1).toEqual(ci2);
    expect(ci1.lo).toBeLessThanOrEqual(m);
    expect(ci1.hi).toBeGreaterThanOrEqual(m);
  });

  it("summarize attaches a CI and keeps the samples", () => {
    const base = {
      library: "yjs" as const,
      version: "test",
      scenario: "T",
      k: null,
      metric: "m",
      unit: "ms",
      mode: "steady-state",
      converged: true,
      byteIdentical: true,
      wasmBacked: false,
      warmupDiscarded: 3,
      note: "",
    };
    const rec: MetricResult = summarize(base, [1, 2, 3, 4, 5]);
    expect(rec.samples).toEqual([1, 2, 3, 4, 5]);
    expect(rec.median).toBe(3);
    expect(rec.ci95.lo).toBeLessThanOrEqual(rec.median);
  });
});
