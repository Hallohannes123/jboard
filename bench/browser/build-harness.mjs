import { build } from "vite";
import { readFile, writeFile, readdir } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const HARNESS = join(here, "harness");
const OUT = join(here, "dist");
const RESULTS = join(here, "..", "results");

await build({
  root: HARNESS,
  build: { outDir: OUT, emptyOutDir: true, chunkSizeWarningLimit: 4000 },

  logLevel: "warn",
});

const ARMS = ["yjs", "automerge", "loro"];
const assetsDir = join(OUT, "assets");
const files = await readdir(assetsDir);

function bytes(buf) {
  return { minB: buf.length, gzipB: gzipSync(buf).length };
}

const perArm = {};
for (const arm of ARMS) perArm[arm] = { jsMinB: 0, jsGzipB: 0, wasmMinB: 0, wasmGzipB: 0 };

for (const f of files) {
  const buf = await readFile(join(assetsDir, f));
  const { minB, gzipB } = bytes(buf);
  for (const arm of ARMS) {
    if (f.startsWith(`${arm}-`) && f.endsWith(".js")) {
      perArm[arm].jsMinB += minB;
      perArm[arm].jsGzipB += gzipB;
    }

    if (
      f.startsWith(`${arm === "automerge" ? "automerge_wasm_bg" : `${arm}_wasm_bg`}`) &&
      f.endsWith(".wasm")
    ) {
      perArm[arm].wasmMinB += minB;
      perArm[arm].wasmGzipB += gzipB;
    }
  }
}

await writeFile(join(RESULTS, "bundle-sizes.json"), JSON.stringify(perArm, null, 2));
process.stdout.write(`[bundle] wrote ${join(RESULTS, "bundle-sizes.json")}\n`);
for (const arm of ARMS) {
  const a = perArm[arm];
  process.stdout.write(
    `[bundle] ${arm}: js ${a.jsMinB}B min / ${a.jsGzipB}B gzip; wasm ${a.wasmMinB}B min / ${a.wasmGzipB}B gzip\n`,
  );
}
