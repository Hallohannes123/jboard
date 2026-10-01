import { useState } from "react";
import type { ShapeId, ShapeKind } from "@wb/crdt";
import { Canvas } from "./Canvas.js";
import { useBackend, type BackendKind } from "./useBackend.js";
import { APP_VERSION } from "./version.js";

const BACKENDS: BackendKind[] = ["yjs", "automerge", "loro"];
const PALETTE = ["#ef4444", "#3b82f6", "#22c55e", "#eab308", "#a855f7"];

function defaults(kind: ShapeKind, x: number, y: number, fill: string) {
  const base = {
    id: crypto.randomUUID() as ShapeId,
    kind,
    x,
    y,
    w: 80,
    h: 60,
    rotation: 0,
    fill,
    stroke: "#111827",
    strokeWidth: 2,
  };
  if (kind === "text") return { ...base, h: 24, text: "text" };
  if (kind === "line" || kind === "draw") {
    return { ...base, points: [0, 0, 80, 40] };
  }
  return base;
}

export function App() {
  const [kind, setKind] = useState<BackendKind>("yjs");
  const [tool, setTool] = useState<ShapeKind>("rect");
  const [fill, setFill] = useState(PALETTE[0]!);
  const [selectedId, setSelectedId] = useState<ShapeId | null>(null);
  const { shapes, addShape, moveShape, deleteShape, undo, redo } = useBackend(kind);

  const create = (x: number, y: number) => {
    const s = defaults(tool, x, y, fill);
    addShape(s);
    setSelectedId(s.id);
  };

  const removeSelected = () => {
    if (selectedId === null) return;
    deleteShape(selectedId);
    setSelectedId(null);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
      <div
        style={{
          display: "flex",
          gap: 12,
          padding: 8,
          alignItems: "center",
          borderBottom: "1px solid #e5e7eb",
        }}
      >
        <label>
          backend{" "}
          <select value={kind} onChange={(e) => setKind(e.target.value as BackendKind)}>
            {BACKENDS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </label>

        <span style={{ display: "flex", gap: 4 }}>
          {(["rect", "ellipse", "line", "draw", "text"] as ShapeKind[]).map((k) => (
            <button
              key={k}
              onClick={() => setTool(k)}
              style={{ fontWeight: tool === k ? 700 : 400 }}
            >
              {k}
            </button>
          ))}
        </span>

        <span style={{ display: "flex", gap: 4 }}>
          {PALETTE.map((c) => (
            <button
              key={c}
              onClick={() => setFill(c)}
              aria-label={`fill ${c}`}
              style={{
                width: 20,
                height: 20,
                background: c,
                outline: fill === c ? "2px solid #111827" : "none",
              }}
            />
          ))}
        </span>

        <button onClick={removeSelected} disabled={selectedId === null}>
          delete
        </button>
        <button onClick={undo}>undo</button>
        <button onClick={redo}>redo</button>
        <span style={{ marginLeft: "auto", color: "#6b7280" }}>{shapes.length} shapes</span>
        <span style={{ color: "#9ca3af", fontSize: 12 }}>{APP_VERSION}</span>
      </div>

      <div style={{ flex: 1 }}>
        <Canvas
          shapes={shapes}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onCreateAt={create}
          onMove={moveShape}
          width={window.innerWidth}
          height={window.innerHeight - 50}
        />
      </div>
    </div>
  );
}
