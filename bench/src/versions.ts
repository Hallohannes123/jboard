import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);

const PKG: Record<"yjs" | "automerge" | "loro", string> = {
  yjs: "yjs",
  automerge: "@automerge/automerge",
  loro: "loro-crdt",
};

const cache = new Map<string, string>();

function readPkgVersion(pkg: string): string {
  try {
    const meta = require(`${pkg}/package.json`) as { version?: string };
    if (meta.version) return meta.version;
  } catch {}
  const entry = require.resolve(pkg);
  let dir = dirname(entry);
  for (let i = 0; i < 12; i++) {
    try {
      const meta = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as {
        name?: string;
        version?: string;
      };
      if (meta.name === pkg && meta.version) return meta.version;
    } catch {}
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return "unresolved";
}

export function libVersion(kind: "yjs" | "automerge" | "loro"): string {
  const pkg = PKG[kind];
  const hit = cache.get(pkg);
  if (hit !== undefined) return hit;
  const v = readPkgVersion(pkg);
  cache.set(pkg, v);
  return v;
}

export function isWasmBacked(kind: "yjs" | "automerge" | "loro"): boolean {
  return kind === "automerge" || kind === "loro";
}
