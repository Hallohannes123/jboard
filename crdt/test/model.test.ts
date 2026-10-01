import { describe, expect, it } from "vitest";
import { byZ, keyAfter, keyBefore, keyBetween } from "../src/model.js";

describe("fractional index", () => {
  it("produces a key strictly between two neighbours", () => {
    const a = keyBetween(null, null);
    const b = keyAfter(a);
    const mid = keyBetween(a, b);
    expect(a < mid).toBe(true);
    expect(mid < b).toBe(true);
  });

  it("keyAfter and keyBefore extend an existing key", () => {
    const k = keyBetween(null, null);
    expect(keyBefore(k) < k).toBe(true);
    expect(k < keyAfter(k)).toBe(true);
  });

  it("stays ordered across a long append chain", () => {
    const keys: string[] = [];
    let prev: string | null = null;
    for (let i = 0; i < 200; i++) {
      prev = keyAfter(prev);
      keys.push(prev);
    }
    const sorted = [...keys].sort();
    expect(keys).toEqual(sorted);
  });

  it("subdivides indefinitely between two adjacent keys", () => {
    const lo = keyBetween(null, null);
    let hi = keyAfter(lo);
    for (let i = 0; i < 50; i++) {
      const m = keyBetween(lo, hi);
      expect(lo < m && m < hi).toBe(true);
      hi = m;
    }
  });

  it("rejects reversed bounds", () => {
    expect(() => keyBetween("z", "a")).toThrow();
  });

  it("concurrent insert-to-front yields identical keys, resolved by id in byZ", () => {
    const neighbour = keyBetween(null, null);
    const k1 = keyBefore(neighbour);
    const k2 = keyBefore(neighbour);
    expect(k1).toBe(k2);

    const s1 = { id: "aaa", z: k1 } as Parameters<typeof byZ>[0];
    const s2 = { id: "bbb", z: k2 } as Parameters<typeof byZ>[0];
    expect(byZ(s1, s2)).toBeLessThan(0);
    expect(byZ(s2, s1)).toBeGreaterThan(0);
  });
});
