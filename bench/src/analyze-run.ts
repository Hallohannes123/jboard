import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { analyze, type CellAnalysis } from "./analysis.js";
import type { MetricResult } from "./metrics.js";

const here = dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = join(here, "..", "results");

interface RunFile {
  commit: string;
  timestamp: string;
  results: MetricResult[];
}

function newestRun(): string {
  const files = readdirSync(RESULTS_DIR)
    .filter((f) => f.startsWith("run-") && f.endsWith(".json"))
    .sort();
  if (files.length === 0)
    throw new Error(`no run-*.json in ${RESULTS_DIR} — run the harness first`);
  return join(RESULTS_DIR, files[files.length - 1]!);
}

function fmt(n: number): string {
  if (Number.isNaN(n)) return "NaN";
  if (n === 0) return "0";
  if (Math.abs(n) >= 1000) return Math.round(n).toString();
  return n.toPrecision(3);
}

function printCell(c: CellAnalysis): void {
  const { scenario, metric, mode, k, unit } = c.key;
  const head = `${scenario} · ${metric}/${mode}${k !== null ? ` k=${k}` : ""} (${unit})`;
  console.log(`\n=== ${head} ===`);
  for (const p of c.perLibrary) {
    const byte = p.byteIdentical ? "" : " [snapshot bytes non-canonical]";
    console.log(
      `  ${p.library.padEnd(9)} ${fmt(p.median)} ${unit} [${fmt(p.ci95.lo)}, ${fmt(p.ci95.hi)}] (mad ${fmt(p.mad)}, n=${p.reps})${byte}`,
    );
  }
  for (const d of c.differences) {
    const verdict = d.bracketsZero ? "CI includes 0 — run does not separate them" : "CI clear of 0";
    console.log(
      `    Δ ${d.b}−${d.a}: ${fmt(d.deltaMedian)} ${unit} [${fmt(d.ci95.lo)}, ${fmt(d.ci95.hi)}] — ${verdict}`,
    );
  }
}

function main(): void {
  const argPath = process.argv[2];
  const runPath = argPath ?? newestRun();
  const run = JSON.parse(readFileSync(runPath, "utf8")) as RunFile;

  console.log(`=== analysis of ${runPath} ===`);
  console.log(`commit=${run.commit} timestamp=${run.timestamp} records=${run.results.length}`);

  const cells = analyze(run.results);
  console.log(`${cells.length} cells (converged records grouped by scenario·metric·mode·k)`);

  let separating = 0;
  let total = 0;
  for (const c of cells) {
    printCell(c);
    for (const d of c.differences) {
      total++;
      if (!d.bracketsZero) separating++;
    }
  }

  const outFile = runPath.replace(/run-([0-9a-f]+)\.json$/, "analysis-$1.json");
  writeFileSync(
    outFile,
    JSON.stringify({ commit: run.commit, timestamp: run.timestamp, cells }, null, 2),
  );
  console.log(`\nwrote ${outFile}`);
  console.log(
    `${separating}/${total} pairwise differences have a 95% CI clear of 0 (the rest do not separate the two arms in this run)`,
  );
}

main();
