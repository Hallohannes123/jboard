import type { Ci } from "./stats.js";
import { median } from "./stats.js";
import { mulberry32 } from "./rng.js";
import type { MetricResult } from "./metrics.js";

export type Library = MetricResult["library"];

export interface CellKey {
  scenario: string;
  metric: string;
  mode: string;
  k: number | null;
  unit: string;
}

export function cellKeyOf(r: MetricResult): CellKey {
  return { scenario: r.scenario, metric: r.metric, mode: r.mode, k: r.k, unit: r.unit };
}

function keyStr(c: CellKey): string {
  return `${c.scenario}|${c.metric}|${c.mode}|${c.k ?? "-"}|${c.unit}`;
}

export interface PerLibrary {
  library: Library;
  version: string;
  median: number;
  ci95: Ci;
  mad: number;
  reps: number;
  converged: boolean;
  byteIdentical: boolean;
}

export interface Difference {
  a: Library;
  b: Library;
  deltaMedian: number;
  ci95: Ci;
  bracketsZero: boolean;
}

export interface CellAnalysis {
  key: CellKey;
  perLibrary: PerLibrary[];
  differences: Difference[];
}

export function bootstrapDiffCi(
  aSamples: readonly number[],
  bSamples: readonly number[],
  opts: { resamples?: number; alpha?: number; seed?: number } = {},
): { delta: number; ci: Ci } {
  const { resamples = 2000, alpha = 0.05, seed = 0x0d1ff } = opts;
  const delta = median(bSamples) - median(aSamples);
  if (aSamples.length === 0 || bSamples.length === 0) {
    return { delta: NaN, ci: { lo: NaN, hi: NaN } };
  }

  if (aSamples.length === 1 && bSamples.length === 1) {
    return { delta, ci: { lo: delta, hi: delta } };
  }
  const rng = mulberry32(seed);
  const na = aSamples.length;
  const nb = bSamples.length;
  const diffs = new Array<number>(resamples);
  const ra = new Array<number>(na);
  const rb = new Array<number>(nb);
  for (let r = 0; r < resamples; r++) {
    for (let i = 0; i < na; i++) ra[i] = aSamples[Math.floor(rng() * na)]!;
    for (let i = 0; i < nb; i++) rb[i] = bSamples[Math.floor(rng() * nb)]!;
    diffs[r] = median(rb) - median(ra);
  }
  diffs.sort((x, y) => x - y);
  const loIdx = Math.floor((alpha / 2) * resamples);
  const hiIdx = Math.min(resamples - 1, Math.ceil((1 - alpha / 2) * resamples) - 1);
  return { delta, ci: { lo: diffs[loIdx]!, hi: diffs[hiIdx]! } };
}

function hashSeed(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function analyze(records: readonly MetricResult[]): CellAnalysis[] {
  const cells = new Map<string, MetricResult[]>();
  for (const r of records) {
    if (!r.converged) continue;

    if (r.samples.length === 0) continue;
    const k = keyStr(cellKeyOf(r));
    const bucket = cells.get(k);
    if (bucket === undefined) cells.set(k, [r]);
    else bucket.push(r);
  }

  const out: CellAnalysis[] = [];
  for (const bucket of cells.values()) {
    const key = cellKeyOf(bucket[0]!);

    const byLib = [...bucket].sort((x, y) => x.library.localeCompare(y.library));

    const perLibrary: PerLibrary[] = byLib.map((r) => ({
      library: r.library,
      version: r.version,
      median: r.median,
      ci95: r.ci95,
      mad: r.mad,
      reps: r.reps,
      converged: r.converged,
      byteIdentical: r.byteIdentical,
    }));

    const differences: Difference[] = [];
    for (let i = 0; i < byLib.length; i++) {
      for (let j = i + 1; j < byLib.length; j++) {
        const a = byLib[i]!;
        const b = byLib[j]!;
        const seed = hashSeed(`${a.library}:${b.library}:${keyStr(key)}`);
        const { delta, ci } = bootstrapDiffCi(a.samples, b.samples, { seed });
        differences.push({
          a: a.library,
          b: b.library,
          deltaMedian: delta,
          ci95: ci,
          bracketsZero: ci.lo <= 0 && ci.hi >= 0,
        });
      }
    }
    out.push({ key, perLibrary, differences });
  }

  out.sort((p, q) => keyStr(p.key).localeCompare(keyStr(q.key)));
  return out;
}
