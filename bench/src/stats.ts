import { mulberry32 } from "./rng.js";

export function median(xs: readonly number[]): number {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 === 0 ? (s[mid - 1]! + s[mid]!) / 2 : s[mid]!;
}

export function mad(xs: readonly number[]): number {
  if (xs.length === 0) return NaN;
  const m = median(xs);
  return median(xs.map((x) => Math.abs(x - m)));
}

export function mean(xs: readonly number[]): number {
  if (xs.length === 0) return NaN;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

export function percentile(xs: readonly number[], p: number): number {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);

  const idx = Math.min(s.length - 1, Math.max(0, Math.ceil(p * s.length) - 1));
  return s[idx]!;
}

export interface Ci {
  lo: number;
  hi: number;
}

export function bootstrapMedianCi(
  xs: readonly number[],
  opts: { resamples?: number; alpha?: number; seed?: number } = {},
): Ci {
  const { resamples = 2000, alpha = 0.05, seed = 0x5eed } = opts;
  if (xs.length === 0) return { lo: NaN, hi: NaN };
  if (xs.length === 1) return { lo: xs[0]!, hi: xs[0]! };

  const rng = mulberry32(seed);
  const medians = new Array<number>(resamples);
  const n = xs.length;
  for (let r = 0; r < resamples; r++) {
    const sample = new Array<number>(n);
    for (let i = 0; i < n; i++) sample[i] = xs[Math.floor(rng() * n)]!;
    medians[r] = median(sample);
  }
  medians.sort((a, b) => a - b);
  const loIdx = Math.floor((alpha / 2) * resamples);
  const hiIdx = Math.min(resamples - 1, Math.ceil((1 - alpha / 2) * resamples) - 1);
  return { lo: medians[loIdx]!, hi: medians[hiIdx]! };
}
