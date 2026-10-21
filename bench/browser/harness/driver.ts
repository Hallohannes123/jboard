import type { CrdtBackend } from "@wb/crdt";
import { keyBetween, type Shape } from "@wb/crdt/model";

type Arm = "yjs" | "automerge" | "loro";

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

async function loadBackendCtor(arm: Arm): Promise<new () => CrdtBackend> {
  switch (arm) {
    case "yjs":
      return (await import("@wb/crdt/yjs")).YjsBackend;
    case "automerge":
      return (await import("@wb/crdt/automerge")).AutomergeBackend;
    case "loro":
      return (await import("@wb/crdt/loro")).LoroBackend;
  }
}

function makeShape(id: string, z: string, i: number): Shape {
  return {
    id,
    kind: "rect",
    x: i,
    y: i,
    w: 80,
    h: 60,
    rotation: 0,
    z,
    fill: "#3b82f6",
    stroke: "#111827",
    strokeWidth: 2,
  };
}

async function run(): Promise<void> {
  const params = new URLSearchParams(location.search);
  const arm = (params.get("arm") ?? "yjs") as Arm;
  const shapeCount = Number(params.get("shapes") ?? 200);

  try {
    const t0 = performance.now();
    const Ctor = await loadBackendCtor(arm);
    const moduleLoadMs = performance.now() - t0;

    const t1 = performance.now();

    const source = new Ctor();
    let z: string | null = null;
    for (let i = 0; i < shapeCount; i++) {
      z = keyBetween(z, null);
      source.putShape(makeShape(`s${i}`, z, i));
    }
    const snap = source.getSnapshot();
    const replica = new Ctor();
    replica.load(snap);
    replica.getAllShapes();
    const coldOpMs = performance.now() - t1;

    window.__benchResult = { arm, moduleLoadMs, coldOpMs };
  } catch (e) {
    window.__benchResult = {
      arm,
      moduleLoadMs: NaN,
      coldOpMs: NaN,
      error: e instanceof Error ? e.message : String(e),
    };
  }
  document.getElementById("status")!.textContent = "done";
}

void run();
