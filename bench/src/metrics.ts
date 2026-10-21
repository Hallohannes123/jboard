import { bootstrapMedianCi, mad, median, percentile, type Ci } from "./stats.js";
import { forceGc } from "./env.js";

export interface MetricResult {
  library: "yjs" | "automerge" | "loro";
  version: string;
  scenario: string;
  k: number | null;
  metric: string;
  unit: string;
  median: number;
  mad: number;
  p95: number;
  ci95: Ci;
  reps: number;
  warmupDiscarded: number;
  samples: number[];
  converged: boolean;
  byteIdentical: boolean;
  mode: string;
  wasmBacked: boolean;
  note: string;
}

export interface MeasureOpts {
  reps?: number;
  warmup?: number;
}

export function timeReps(setup: () => void, fn: () => void, opts: MeasureOpts = {}): number[] {
  const reps = opts.reps ?? 12;
  const warmup = opts.warmup ?? 3;
  const total = reps + warmup;
  const durations: number[] = [];
  for (let i = 0; i < total; i++) {
    setup();
    const t0 = performance.now();
    fn();
    const t1 = performance.now();
    if (i >= warmup) durations.push(t1 - t0);
  }
  return durations;
}

export function summarize(
  base: Omit<MetricResult, "median" | "mad" | "p95" | "ci95" | "reps" | "samples">,
  samples: number[],
): MetricResult {
  const seed = hashSeed(`${base.library}:${base.scenario}:${base.metric}:${base.mode}`);
  return {
    ...base,
    median: median(samples),
    mad: mad(samples),
    p95: percentile(samples, 0.95),
    ci95: bootstrapMedianCi(samples, { seed }),
    reps: samples.length,
    samples,
  };
}

export function excluded(
  base: Omit<MetricResult, "median" | "mad" | "p95" | "ci95" | "reps" | "samples">,
): MetricResult {
  return {
    ...base,
    median: NaN,
    mad: NaN,
    p95: NaN,
    ci95: { lo: NaN, hi: NaN },
    reps: 0,
    samples: [],
    converged: false,
  };
}

export function notApplicable(
  base: Omit<MetricResult, "median" | "mad" | "p95" | "ci95" | "reps" | "samples">,
): MetricResult {
  return {
    ...base,
    median: NaN,
    mad: NaN,
    p95: NaN,
    ci95: { lo: NaN, hi: NaN },
    reps: 0,
    samples: [],
  };
}

export function measureMemDelta(
  before: () => void,
  work: () => void,
): { arrayBuffersB: number; heapUsedB: number } | null {
  const gcOk = forceGc();
  if (!gcOk) return null;
  before();
  forceGc();
  const m0 = process.memoryUsage();
  work();
  forceGc();
  const m1 = process.memoryUsage();
  return {
    arrayBuffersB: m1.arrayBuffers - m0.arrayBuffers,
    heapUsedB: m1.heapUsed - m0.heapUsed,
  };
}

function hashSeed(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
