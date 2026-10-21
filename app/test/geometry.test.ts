import { describe, expect, it } from "vitest";
import { freehandBounds } from "../src/geometry.js";

describe("freehandBounds (A7)", () => {
  it("covers a stroke drawn down-and-right of the origin", () => {
    const r = freehandBounds(100, 100, [0, 0, 20, 10, 40, 30]);
    expect(r.x).toBe(100);
    expect(r.y).toBe(100);
    expect(r.w).toBe(40);
    expect(r.h).toBe(30);

    expect(r.points).toEqual([0, 0, 20, 10, 40, 30]);
  });

  it("covers a stroke drawn up-and-left of the origin (the bug)", () => {
    const r = freehandBounds(100, 100, [0, 0, -30, -20, -10, 10]);

    expect(r.x).toBe(70);
    expect(r.y).toBe(80);

    expect(r.w).toBe(30);
    expect(r.h).toBe(30);

    expect(r.points).toEqual([30, 20, 0, 0, 20, 30]);
    expect(Math.min(...r.points)).toBe(0);
  });

  it("never collapses to zero size for a degenerate stroke", () => {
    const r = freehandBounds(5, 5, [0, 0]);
    expect(r.w).toBeGreaterThanOrEqual(1);
    expect(r.h).toBeGreaterThanOrEqual(1);
  });
});
