import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { captureEnv } from "./env.js";
import { allFairnessChecks } from "./fairness.js";
import type { MetricResult } from "./metrics.js";
import { runS1, runS2, runS3, runS4, runS5, runS6, type Kind } from "./scenarios.js";

const KINDS: Kind[] = ["yjs", "automerge", "loro"];
const S2_KS = [2, 10, 50] as const;

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

function main(): void {
  mkdirSync(RESULTS_DIR, { recursive: true });
  const env = captureEnv();
  const commit = gitCommit();
  const timestamp = isoNow();

  console.log(`=== jboard benchmark harness ===`);
  console.log(`commit=${commit} node=${env.version} cpu="${env.cpu}" cores=${env.cores}`);
  console.log(`exposeGc=${env.exposeGc}`);

  console.log(`--- fairness self-checks ---`);
  for (const f of allFairnessChecks()) {
    console.log(`[fairness] ${f.rule}: ${f.pass ? "PASS" : "WARN"} — ${f.detail}`);
  }

  const all: MetricResult[] = [];

  for (const kind of KINDS) {
    console.log(`--- ${kind} ---`);
    all.push(...tagRun(runS1(kind), commit, timestamp, env));
    for (const k of S2_KS) all.push(...tagRun(runS2(kind, k), commit, timestamp, env));
    all.push(...tagRun(runS3(kind), commit, timestamp, env));
    all.push(...tagRun(runS4(kind), commit, timestamp, env));
    all.push(...tagRun(runS5(kind), commit, timestamp, env));
    all.push(...tagRun(runS6(kind), commit, timestamp, env));
  }

  const outFile = join(RESULTS_DIR, `run-${commit.slice(0, 8)}.json`);
  writeFileSync(outFile, JSON.stringify({ commit, timestamp, env, results: all }, null, 2));

  console.log(`--- summary (${all.length} records) ---`);
  let excludedCount = 0;
  let nonCanonicalCount = 0;
  let naCount = 0;
  for (const r of all) {
    if (!r.converged) excludedCount++;
    if (r.converged && !r.byteIdentical) nonCanonicalCount++;

    const isNa = r.converged && Number.isNaN(r.median);
    if (isNa) naCount++;
    const val = !r.converged
      ? "EXCLUDED (gate fail)"
      : isNa
        ? "N/A (metric unavailable)"
        : `${fmt(r.median)} ${r.unit} [${fmt(r.ci95.lo)}, ${fmt(r.ci95.hi)}]`;

    const byte = r.converged ? ` byteIdentical=${r.byteIdentical}` : "";
    console.log(
      `[result] ${r.library} ${r.scenario} ${r.metric}/${r.mode}${r.k !== null ? ` k=${r.k}` : ""}: ${val} converged=${r.converged}${byte}`,
    );
  }
  console.log(`wrote ${outFile}`);
  console.log(`excluded ${excludedCount}/${all.length} records (gate failures)`);
  console.log(
    `n/a ${naCount}/${all.length} records (converged, metric unavailable — e.g. no wasm handle)`,
  );
  console.log(
    `non-canonical ${nonCanonicalCount}/${all.length} records (converged logically, snapshot bytes differed)`,
  );

  if (excludedCount > 0) {
    console.error(`FAIL: ${excludedCount} records failed the convergence gate`);
    process.exitCode = 1;
  }
}

function tagRun(
  records: MetricResult[],
  commit: string,
  timestamp: string,
  env: ReturnType<typeof captureEnv>,
): (MetricResult & { commit: string; timestamp: string; env: typeof env })[] {
  return records.map((r) => ({ ...r, commit, timestamp, env }));
}

function fmt(n: number): string {
  if (Number.isNaN(n)) return "NaN";
  if (n === 0) return "0";
  if (Math.abs(n) >= 1000) return Math.round(n).toString();
  return n.toPrecision(3);
}

main();
