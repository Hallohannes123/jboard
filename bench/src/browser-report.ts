import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { summarize, type MetricResult } from "./metrics.js";
import { libVersion, isWasmBacked } from "./versions.js";

type Arm = "yjs" | "automerge" | "loro";

const here = dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = join(here, "..", "results");

function gitCommit(): string {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}
function isoNow(): string {
  try {
    return execFileSync("date", ["-u", "+%Y-%m-%dT%H:%M:%SZ"], { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

interface ArmSamples {
  arm: Arm;
  moduleLoadMs: number[];
  coldOpMs: number[];
}
interface RawFile {
  reps: number;
  warmup: number;
  arms: ArmSamples[];
}
interface BundleEntry {
  jsMinB: number;
  jsGzipB: number;
  wasmMinB: number;
  wasmGzipB: number;
}

function base(
  arm: Arm,
  scenario: string,
  metric: string,
  unit: string,
  mode: string,
  warmupDiscarded: number,
  note: string,
): Omit<MetricResult, "median" | "mad" | "p95" | "ci95" | "reps" | "samples"> {
  return {
    library: arm,
    version: libVersion(arm),
    scenario,
    k: null,
    metric,
    unit,
    mode,

    converged: true,
    byteIdentical: true,
    wasmBacked: isWasmBacked(arm),
    warmupDiscarded,
    note,
  };
}

function main(): void {
  const samplesPath = join(RESULTS_DIR, "browser-samples.json");
  if (!existsSync(samplesPath)) {
    console.error(`no ${samplesPath} — run 'pnpm bench:browser' first`);
    process.exitCode = 3;
    return;
  }
  const raw = JSON.parse(readFileSync(samplesPath, "utf8")) as RawFile;
  const bundlePath = join(RESULTS_DIR, "bundle-sizes.json");
  const bundles = existsSync(bundlePath)
    ? (JSON.parse(readFileSync(bundlePath, "utf8")) as Record<Arm, BundleEntry>)
    : null;

  const commit = gitCommit();
  const timestamp = isoNow();
  const env = { runtime: "browser", engine: "chromium (playwright)", commit };

  console.log(`=== browser-arm benchmark report ===`);
  console.log(`commit=${commit} reps=${raw.reps} warmup=${raw.warmup}`);

  const out: MetricResult[] = [];
  for (const armRec of raw.arms) {
    const { arm } = armRec;
    out.push(
      summarize(
        base(
          arm,
          "B1-cold-start",
          "moduleLoadMs",
          "ms",
          "browser-cold-start",
          raw.warmup,
          isWasmBacked(arm)
            ? "isolated adapter import incl. wasm fetch+compile+instantiate, cold module cache"
            : "isolated adapter import (pure js parse/eval), cold module cache",
        ),
        armRec.moduleLoadMs,
      ),
    );
    out.push(
      summarize(
        base(
          arm,
          "B1-cold-start",
          "coldOpMs",
          "ms",
          "browser-cold-start",
          raw.warmup,
          "first use: build 200-shape doc, snapshot, load into fresh replica, materialise",
        ),
        armRec.coldOpMs,
      ),
    );

    if (bundles && bundles[arm]) {
      const b = bundles[arm];
      const bundleNote =
        "deployed artifact bundle size; wasm payload dominates for the wasm arms (annotate against pure-js yjs)";
      out.push(
        summarize(base(arm, "B2-bundle-size", "bundleJsMinB", "bytes", "min", 0, bundleNote), [
          b.jsMinB,
        ]),
      );
      out.push(
        summarize(base(arm, "B2-bundle-size", "bundleJsGzipB", "bytes", "gzip", 0, bundleNote), [
          b.jsGzipB,
        ]),
      );
      out.push(
        summarize(base(arm, "B2-bundle-size", "bundleWasmMinB", "bytes", "min", 0, bundleNote), [
          b.wasmMinB,
        ]),
      );
      out.push(
        summarize(base(arm, "B2-bundle-size", "bundleWasmGzipB", "bytes", "gzip", 0, bundleNote), [
          b.wasmGzipB,
        ]),
      );
    }
  }

  const tagged = out.map((r) => ({ ...r, commit, timestamp, env }));
  mkdirSync(RESULTS_DIR, { recursive: true });
  const outFile = join(RESULTS_DIR, `browser-run-${commit.slice(0, 8)}.json`);
  writeFileSync(outFile, JSON.stringify({ commit, timestamp, env, results: tagged }, null, 2));

  console.log(`--- browser records (${tagged.length}) ---`);
  for (const r of out) {
    const val = Number.isNaN(r.median)
      ? "NaN"
      : `${r.median.toPrecision(4)} ${r.unit} [${r.ci95.lo.toPrecision(4)}, ${r.ci95.hi.toPrecision(4)}]`;
    console.log(`[browser-result] ${r.library} ${r.scenario} ${r.metric}/${r.mode}: ${val}`);
  }
  console.log(`wrote ${outFile}`);
}

main();
