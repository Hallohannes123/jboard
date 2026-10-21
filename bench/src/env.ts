import { cpus, arch, platform, totalmem } from "node:os";
import process from "node:process";

export interface Env {
  runtime: "node";
  version: string;
  v8: string;
  arch: string;
  platform: string;
  cpu: string;
  cores: number;
  totalMemMb: number;
  exposeGc: boolean;
}

export function captureEnv(): Env {
  const c = cpus();
  return {
    runtime: "node",
    version: process.version,
    v8: process.versions.v8,
    arch: arch(),
    platform: platform(),
    cpu: c[0]?.model ?? "unknown",
    cores: c.length,
    totalMemMb: Math.round(totalmem() / (1024 * 1024)),
    exposeGc: typeof global.gc === "function",
  };
}

export function forceGc(): boolean {
  if (typeof global.gc === "function") {
    global.gc();
    global.gc();
    return true;
  }
  return false;
}

export interface MemSample {
  heapUsedB: number;
  externalB: number;
  arrayBuffersB: number;
  rssB: number;
}

export function sampleMemory(): MemSample {
  const m = process.memoryUsage();
  return {
    heapUsedB: m.heapUsed,
    externalB: m.external,
    arrayBuffersB: m.arrayBuffers,
    rssB: m.rss,
  };
}
