import { describe, expect, it } from "vitest";
import { analyze, bootstrapDiffCi, cellKeyOf } from "../src/analysis.js";
import { summarize, type MetricResult } from "../src/metrics.js";

function record(library: MetricResult["library"], samples: number[]): MetricResult {
  return summarize(
    {
      library,
      version: "test",
      scenario: "S1",
      k: null,
      metric: "localApplyMs",
      unit: "ms",
      mode: "steady-state",
      converged: true,
      byteIdentical: true,
      wasmBacked: false,
      warmupDiscarded: 3,
      note: "",
    },
    samples,
  );
}

describe("difference CI", () => {
  it("brackets zero when the two samples overlap", () => {
    const a = [10, 11, 9, 10, 12, 8, 11, 9, 10, 10];
    const b = [10, 9, 11, 10, 12, 8, 10, 11, 9, 10];
    const { delta, ci } = bootstrapDiffCi(a, b, { seed: 1 });
    expect(Math.abs(delta)).toBeLessThan(2);
    expect(ci.lo).toBeLessThanOrEqual(0);
    expect(ci.hi).toBeGreaterThanOrEqual(0);
  });

  it("stays clear of zero when the samples are well separated", () => {
    const a = [10, 11, 9, 10, 12, 8, 11, 9, 10, 10];
    const b = [100, 101, 99, 100, 102, 98, 101, 99, 100, 100];
    const { delta, ci } = bootstrapDiffCi(a, b, { seed: 1 });
    expect(delta).toBeGreaterThan(80);

    expect(ci.lo).toBeGreaterThan(0);
  });

  it("is reproducible from the same seed", () => {
    const a = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const b = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
    expect(bootstrapDiffCi(a, b, { seed: 7 })).toEqual(bootstrapDiffCi(a, b, { seed: 7 }));
  });

  it("returns a degenerate interval for single-value size metrics", () => {
    const { delta, ci } = bootstrapDiffCi([25407], [10630], { seed: 1 });
    expect(delta).toBe(10630 - 25407);
    expect(ci.lo).toBe(delta);
    expect(ci.hi).toBe(delta);
  });
});

describe("analyze", () => {
  it("groups by cell and produces one difference per library pair", () => {
    const records = [
      record("yjs", [10, 10, 11, 9, 10, 10, 11, 9, 10, 10]),
      record("automerge", [50, 51, 49, 50, 52, 48, 51, 49, 50, 50]),
      record("loro", [12, 13, 11, 12, 14, 10, 13, 11, 12, 12]),
    ];
    const cells = analyze(records);
    expect(cells.length).toBe(1);
    const cell = cells[0]!;
    expect(cell.perLibrary.map((p) => p.library)).toEqual(["automerge", "loro", "yjs"]);

    expect(cell.differences.length).toBe(3);
  });

  it("excludes gate-failed records from the analysis", () => {
    const good = record("yjs", [10, 10, 11, 9, 10, 10, 11, 9, 10, 10]);
    const bad = { ...record("loro", [1]), converged: false };
    const cells = analyze([good, bad]);

    expect(cells[0]!.perLibrary.length).toBe(1);
    expect(cells[0]!.differences.length).toBe(0);
  });

  it("keeps distinct scenarios/metrics in distinct cells", () => {
    const r1 = record("yjs", [1, 2, 3]);
    const r2 = { ...record("yjs", [4, 5, 6]), scenario: "S5" };
    expect(cellKeyOf(r1).scenario).not.toBe(cellKeyOf(r2).scenario);
    expect(analyze([r1, r2]).length).toBe(2);
  });
});
