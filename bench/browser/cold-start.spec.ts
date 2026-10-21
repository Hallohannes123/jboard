import { test, expect } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

type Arm = "yjs" | "automerge" | "loro";
const ARMS: Arm[] = ["yjs", "automerge", "loro"];
const REPS = 8;
const WARMUP = 2;

interface BrowserSample {
  arm: Arm;
  moduleLoadMs: number;
  coldOpMs: number;
  error?: string;
}

declare global {
  interface Window {
    __benchResult?: BrowserSample;
  }
}

const here = dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = join(here, "..", "results");

interface ArmSamples {
  arm: Arm;
  moduleLoadMs: number[];
  coldOpMs: number[];
}
const collected: ArmSamples[] = [];

test.describe.configure({ mode: "serial" });

for (const arm of ARMS) {
  test(`browser cold-start: ${arm}`, async ({ page }) => {
    const moduleLoad: number[] = [];
    const coldOp: number[] = [];

    for (let rep = 0; rep < REPS + WARMUP; rep++) {
      await page.goto(`/?arm=${arm}&shapes=200`, { waitUntil: "load" });
      await page.waitForFunction(() => window.__benchResult !== undefined, null, {
        timeout: 20_000,
      });
      const sample = (await page.evaluate(() => window.__benchResult)) as BrowserSample;

      expect(sample.error, `${arm} harness error: ${sample.error ?? ""}`).toBeUndefined();
      expect(Number.isFinite(sample.moduleLoadMs)).toBe(true);

      if (rep >= WARMUP) {
        moduleLoad.push(sample.moduleLoadMs);
        coldOp.push(sample.coldOpMs);
      }
    }

    collected.push({ arm, moduleLoadMs: moduleLoad, coldOpMs: coldOp });

    const med = (xs: number[]): number => [...xs].sort((a, b) => a - b)[xs.length >> 1] ?? NaN;
    console.log(
      `[browser] ${arm} moduleLoadMs median≈${med(moduleLoad).toFixed(2)} coldOpMs median≈${med(coldOp).toFixed(2)} reps=${REPS} warmup=${WARMUP}`,
    );
  });
}

test.afterAll(() => {
  if (collected.length === 0) return;
  mkdirSync(RESULTS_DIR, { recursive: true });
  const outFile = join(RESULTS_DIR, "browser-samples.json");

  writeFileSync(outFile, JSON.stringify({ reps: REPS, warmup: WARMUP, arms: collected }, null, 2));
  console.log(`[browser] wrote raw samples ${outFile}`);
});
