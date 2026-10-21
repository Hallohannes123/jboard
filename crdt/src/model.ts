export type ShapeId = string;
export type ShapeKind = "rect" | "ellipse" | "line" | "draw" | "text";

export interface Shape {
  id: ShapeId;
  kind: ShapeKind;
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
  z: string;
  fill: string;
  stroke: string;
  strokeWidth: number;
  points?: number[];
  text?: string;
}

const DIGITS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const BASE = DIGITS.length;

function loDigit(s: string | null, i: number): number {
  if (s === null || i >= s.length) return 0;
  return DIGITS.indexOf(s[i]!);
}
function hiDigit(s: string | null, i: number): number {
  if (s === null || i >= s.length) return BASE;
  return DIGITS.indexOf(s[i]!);
}

export function keyBetween(a: string | null, b: string | null): string {
  if (a !== null && b !== null && a >= b) {
    throw new Error(`keyBetween expects a < b, got a=${a} b=${b}`);
  }

  if (b !== null && /^0*$/.test(b)) {
    throw new Error(
      `keyBetween: no key sorts below all-zeros bound b=${JSON.stringify(b)} — reseed`,
    );
  }

  let out = "";
  for (let i = 0; ; i++) {
    const lo = loDigit(a, i);
    const hi = hiDigit(b, i);
    if (lo + 1 < hi) {
      return out + DIGITS[lo + Math.floor((hi - lo) / 2)];
    }

    out += DIGITS[lo];
  }
}

export function keyAfter(a: string | null): string {
  return keyBetween(a, null);
}

export function keyBefore(b: string | null): string {
  return keyBetween(null, b);
}

export function byZ(a: Shape, b: Shape): number {
  if (a.z < b.z) return -1;
  if (a.z > b.z) return 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
