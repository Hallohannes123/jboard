import { useEffect, useRef, useState } from "react";
import type { Shape, ShapeId, ShapeKind } from "@wb/crdt";
import { keyAfter, keyBefore, keyBetween } from "@wb/crdt";
import { Canvas } from "./Canvas.js";
import type { SizedSpec } from "./Canvas.js";
import { ToolIcon, type Tool } from "./icons.js";
import { useBackend, type BackendKind } from "./useBackend.js";
import { usePresence } from "./usePresence.js";
import { freehandBounds } from "./geometry.js";
import { APP_VERSION } from "./version.js";

const BACKENDS: BackendKind[] = ["yjs", "automerge", "loro"];
const PALETTE = ["#ef4444", "#3b82f6", "#22c55e", "#eab308", "#a855f7"];

const TOOLS: { kind: Tool; label: string; shortcut: string }[] = [
  { kind: "select", label: "Select", shortcut: "V" },
  { kind: "rect", label: "Rectangle", shortcut: "R" },
  { kind: "ellipse", label: "Ellipse", shortcut: "E" },
  { kind: "line", label: "Line", shortcut: "L" },
  { kind: "draw", label: "Draw", shortcut: "D" },
  { kind: "text", label: "Text", shortcut: "T" },
];
const SHORTCUT_TO_TOOL: Record<string, Tool> = {
  v: "select",
  r: "rect",
  e: "ellipse",
  l: "line",
  d: "draw",
  t: "text",
};

const DEFAULT_W = 80;
const DEFAULT_H = 60;
const TEXT_H = 24;
const DEFAULT_STROKE = "#111827";
const DEFAULT_STROKE_W = 2;
const LINE_POINTS = [0, 0, 80, 40];

const CONN_LABEL: Record<"connecting" | "open" | "offline", string> = {
  connecting: "connecting",
  open: "online",
  offline: "offline",
};

function fmtBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / (1024 * 1024)).toFixed(2)} MB`;
}

function defaults(
  kind: ShapeKind,
  x: number,
  y: number,
  fill: string,
  stroke: string,
  strokeWidth: number,
) {
  const base = {
    id: crypto.randomUUID() as ShapeId,
    kind,
    x,
    y,
    w: DEFAULT_W,
    h: DEFAULT_H,
    rotation: 0,
    fill,
    stroke,
    strokeWidth,
  };
  if (kind === "text") return { ...base, h: TEXT_H, text: "text" };
  if (kind === "line" || kind === "draw") {
    return { ...base, points: LINE_POINTS.slice() };
  }
  return base;
}

export function App() {
  const [kind, setKind] = useState<BackendKind>("yjs");
  const [tool, setTool] = useState<Tool>("select");
  const [fill, setFill] = useState(PALETTE[0]!);

  const [stroke, setStroke] = useState(DEFAULT_STROKE);
  const [strokeWidth, setStrokeWidth] = useState(DEFAULT_STROKE_W);

  const [selectedIds, setSelectedIds] = useState<ShapeId[]>([]);

  const [editing, setEditing] = useState<{
    id: ShapeId;
    x: number;
    y: number;
    value: string;
  } | null>(null);
  const { shapes, addShape, moveShape, deleteShape, patchShape, undo, redo, metrics, status } =
    useBackend(kind);

  const [identity] = useState(() => ({
    name: `user-${Math.floor(Math.random() * 1000)}`,
    color: PALETTE[Math.floor(Math.random() * PALETTE.length)]!,
  }));
  const { peers, setLocal } = usePresence("main", identity);

  const [carry, setCarry] = useState<{ from: BackendKind; shapes: Shape[] } | null>(null);

  const switchTo = (next: BackendKind) => {
    if (next === kind) return;

    setCarry(shapes.length > 0 ? { from: kind, shapes: shapes.slice() } : null);
    setKind(next);
    setSelectedIds([]);
  };

  const carryShapesHere = () => {
    if (carry === null) return;
    for (const s of carry.shapes) {
      const { z, id, ...rest } = s;
      addShape({ ...rest, id: crypto.randomUUID() as ShapeId });
    }
    setCarry(null);
  };

  const create = (x: number, y: number) => {
    if (tool === "select") return;
    const s = defaults(tool, x, y, fill, stroke, strokeWidth);
    addShape(s);
    setSelectedIds([s.id]);

    if (s.kind === "text") setEditing({ id: s.id, x, y, value: "text" });
  };

  const startTextEdit = (id: ShapeId, x: number, y: number) => {
    const s = shapes.find((sh) => sh.id === id);
    if (s === undefined || s.kind !== "text") return;
    setSelectedIds([id]);
    setEditing({ id, x, y, value: s.text ?? "" });
  };

  const commitTextEdit = () => {
    if (editing === null) return;
    const trimmed = editing.value.trim();
    if (trimmed === "") deleteShape(editing.id);
    else patchShape(editing.id, { text: trimmed });
    setEditing(null);
  };

  const createFreehand = (x: number, y: number, points: number[]) => {
    const box = freehandBounds(x, y, points);
    const s = {
      id: crypto.randomUUID() as ShapeId,
      kind: "draw" as ShapeKind,
      x: box.x,
      y: box.y,
      w: box.w,
      h: box.h,
      rotation: 0,
      fill: "transparent",
      stroke,
      strokeWidth,
      points: box.points,
    };
    addShape(s);
    setSelectedIds([s.id]);
  };

  const createSized = (spec: SizedSpec) => {
    const s: Omit<Shape, "z"> = {
      id: crypto.randomUUID() as ShapeId,
      kind: spec.kind,
      x: spec.x,
      y: spec.y,
      w: spec.w,
      h: spec.h,
      rotation: 0,
      fill: spec.kind === "line" ? "transparent" : fill,
      stroke,
      strokeWidth,
      ...(spec.points ? { points: spec.points } : {}),
    };
    addShape(s);
    setSelectedIds([s.id]);
  };

  const pickFill = (c: string) => {
    setFill(c);
    for (const id of selectedIds) patchShape(id, { fill: c });
  };

  const pickStroke = (c: string) => {
    setStroke(c);
    for (const id of selectedIds) patchShape(id, { stroke: c });
  };
  const pickStrokeWidth = (w: number) => {
    setStrokeWidth(w);
    for (const id of selectedIds) patchShape(id, { strokeWidth: w });
  };

  const removeSelected = () => {
    if (selectedIds.length === 0) return;
    for (const id of selectedIds) deleteShape(id);
    setSelectedIds([]);
  };

  const bringToFront = () => {
    if (selectedIds.length === 0) return;
    const maxZ = shapes.reduce((m, s) => (s.z > m ? s.z : m), shapes[0]?.z ?? "");
    let z = maxZ;
    for (const id of selectedIds) {
      z = keyAfter(z);
      patchShape(id, { z });
    }
  };
  const sendToBack = () => {
    if (selectedIds.length === 0 || shapes.length === 0) return;
    const sel = new Set(selectedIds);
    const minZ = shapes.reduce((m, s) => (s.z < m ? s.z : m), shapes[0]!.z);

    const ordered = [...selectedIds].reverse();
    try {
      let below = minZ;
      for (const id of ordered) {
        below = keyBefore(below);
        patchShape(id, { z: below });
      }
    } catch {
      const others = shapes.filter((s) => !sel.has(s.id)).sort((a, b) => (a.z < b.z ? -1 : 1));
      let z = keyBetween(null, null);
      for (const id of ordered) {
        patchShape(id, { z });
        z = keyAfter(z);
      }
      for (const s of others) {
        patchShape(s.id, { z });
        z = keyAfter(z);
      }
    }
  };

  const NUDGE = 1;
  const NUDGE_LARGE = 10;
  const nudgeSelection = (dx: number, dy: number) => {
    for (const id of selectedIds) {
      const s = shapes.find((sh) => sh.id === id);
      if (s !== undefined) moveShape(id, s.x + dx, s.y + dy);
    }
  };

  const DUPLICATE_OFFSET = 12;
  const duplicateSelection = () => {
    if (selectedIds.length === 0) return;
    const clones: ShapeId[] = [];
    for (const id of selectedIds) {
      const s = shapes.find((sh) => sh.id === id);
      if (s === undefined) continue;
      const { z, id: _oldId, ...rest } = s;
      const newId = crypto.randomUUID() as ShapeId;
      addShape({ ...rest, id: newId, x: s.x + DUPLICATE_OFFSET, y: s.y + DUPLICATE_OFFSET });
      clones.push(newId);
    }
    if (clones.length > 0) setSelectedIds(clones);
  };

  useEffect(() => {
    setSelectedIds((ids) => {
      const live = ids.filter((id) => shapes.some((s) => s.id === id));
      return live.length === ids.length ? ids : live;
    });
    if (editing !== null && !shapes.some((s) => s.id === editing.id)) {
      setEditing(null);
    }
  }, [shapes, editing]);

  const wrapRef = useRef<HTMLDivElement>(null);
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const el = wrapRef.current;
    if (el === null) return;
    const ro = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (box) setCanvasSize({ width: box.width, height: box.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const editorRef = useRef<HTMLInputElement>(null);
  const blurArmed = useRef(false);
  useEffect(() => {
    if (editing === null) return;
    const el = editorRef.current;
    if (el === null) return;
    blurArmed.current = false;
    el.focus();
    el.select();
    const raf = requestAnimationFrame(() => {
      blurArmed.current = true;
    });
    return () => cancelAnimationFrame(raf);
  }, [editing?.id]);

  const onKeyRef = useRef<(e: KeyboardEvent) => void>(() => {});
  onKeyRef.current = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement | null;
    const typing =
      t && (t.tagName === "INPUT" || t.tagName === "SELECT" || t.tagName === "TEXTAREA");
    if (typing) return;

    if (e.key === "Delete" || e.key === "Backspace") {
      if (selectedIds.length === 0) return;
      e.preventDefault();
      removeSelected();
      return;
    }
    if (e.key === "Escape") {
      setSelectedIds([]);
      return;
    }

    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "d") {
      if (selectedIds.length === 0) return;
      e.preventDefault();
      duplicateSelection();
      return;
    }

    const step = e.shiftKey ? NUDGE_LARGE : NUDGE;
    const nudge: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const delta = nudge[e.key];
    if (delta !== undefined) {
      if (selectedIds.length === 0) return;
      e.preventDefault();
      nudgeSelection(delta[0], delta[1]);
      return;
    }

    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const next = SHORTCUT_TO_TOOL[e.key.toLowerCase()];
    if (next !== undefined) {
      e.preventDefault();
      setTool(next);
    }
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => onKeyRef.current(e);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="app">
      <div className="toolbar">
        <span className="wordmark">jboard</span>
        <span className="toolbar__divider" aria-hidden="true" />

        <label className="toolbar__label" htmlFor="backend-select">
          backend
          <select
            id="backend-select"
            className="select"
            value={kind}
            onChange={(e) => switchTo(e.target.value as BackendKind)}
          >
            {BACKENDS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </label>
        <span
          className="arm-note"
          title="Each backend has its own document — switching shows that arm's own state, not a shared canvas."
        >
          own doc per arm
        </span>
        <span className="toolbar__divider" aria-hidden="true" />

        <span className="toolbar__group" role="group" aria-label="shape tool">
          {TOOLS.map((t) => (
            <button
              key={t.kind}
              onClick={() => setTool(t.kind)}
              className={tool === t.kind ? "tool tool--active" : "tool"}
              aria-pressed={tool === t.kind}
              aria-label={t.label}
              title={`${t.label} (${t.shortcut})`}
            >
              <ToolIcon kind={t.kind} />
              <span className="tool__key">{t.shortcut}</span>
            </button>
          ))}
        </span>
        <span className="toolbar__divider" aria-hidden="true" />

        <span className="toolbar__group" role="group" aria-label="fill colour">
          {PALETTE.map((c) => (
            <button
              key={c}
              onClick={() => pickFill(c)}
              aria-label={`fill ${c}`}
              aria-pressed={fill === c}
              className={fill === c ? "swatch swatch--active" : "swatch"}
              style={{ background: c }}
              title={`Fill ${c}`}
            />
          ))}
        </span>
        <span className="toolbar__divider" aria-hidden="true" />

        <label className="toolbar__label" title="Stroke colour">
          stroke
          <input
            type="color"
            className="stroke-color"
            value={stroke}
            onChange={(e) => pickStroke(e.target.value)}
            aria-label="stroke colour"
          />
        </label>
        <label className="toolbar__label" title="Stroke width">
          <input
            type="range"
            min={0}
            max={12}
            step={1}
            value={strokeWidth}
            onChange={(e) => pickStrokeWidth(Number(e.target.value))}
            aria-label="stroke width"
          />
          <span className="stroke-width-val">{strokeWidth}</span>
        </label>
        <span className="toolbar__divider" aria-hidden="true" />

        <button
          className="btn"
          onClick={removeSelected}
          disabled={selectedIds.length === 0}
          title="Delete selection (Del)"
        >
          delete
        </button>
        <button
          className="btn"
          onClick={duplicateSelection}
          disabled={selectedIds.length === 0}
          title="Duplicate selection (Cmd/Ctrl+D)"
        >
          duplicate
        </button>
        <button
          className="btn"
          onClick={bringToFront}
          disabled={selectedIds.length === 0}
          title="Bring to front"
        >
          front
        </button>
        <button
          className="btn"
          onClick={sendToBack}
          disabled={selectedIds.length === 0}
          title="Send to back"
        >
          back
        </button>
        <button className="btn" onClick={undo} title="Undo">
          undo
        </button>
        <button className="btn" onClick={redo} title="Redo">
          redo
        </button>
        <span className="toolbar__spacer" />
        <span className={`conn conn--${status}`} title={`relay: ${CONN_LABEL[status]}`}>
          <span className="conn__dot" />
          {CONN_LABEL[status]}
        </span>
        <span className="shape-count">{shapes.length} shapes</span>
        <span className="shape-count">{APP_VERSION}</span>
      </div>

      <div className="canvas-wrap" ref={wrapRef}>
        {carry !== null && shapes.length === 0 && (
          <div className="carry-banner">
            <span>
              {kind} has its own empty document. {carry.shapes.length} shape
              {carry.shapes.length === 1 ? "" : "s"} from {carry.from} can be copied in.
            </span>
            <button className="btn" onClick={carryShapesHere}>
              copy {carry.shapes.length} shape{carry.shapes.length === 1 ? "" : "s"} here
            </button>
            <button className="btn" onClick={() => setCarry(null)}>
              dismiss
            </button>
          </div>
        )}

        <div className="hud">
          <div className="hud__head">metrics · {kind}</div>
          <div>last update: {fmtBytes(metrics.lastUpdateB)}</div>
          <div>apply: {metrics.lastApplyMs.toFixed(2)} ms</div>
          <div>doc size: {fmtBytes(metrics.docSizeB)}</div>
        </div>

        {shapes.length === 0 && carry === null && (
          <div className="empty-hint">
            <div className="empty-hint__title">Empty canvas</div>
            <div>
              Pick a tool and click to place a shape. Press <kbd>R</kbd> <kbd>E</kbd> <kbd>L</kbd>{" "}
              <kbd>D</kbd> <kbd>T</kbd> to switch tools, drag with Draw for freehand.
            </div>
          </div>
        )}

        {editing !== null && (
          <input
            ref={editorRef}
            className="text-editor"
            style={{ left: editing.x, top: editing.y }}
            value={editing.value}
            onChange={(e) => setEditing({ ...editing, value: e.target.value })}
            onBlur={() => {
              if (blurArmed.current) commitTextEdit();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitTextEdit();
              else if (e.key === "Escape") setEditing(null);
            }}
          />
        )}

        <Canvas
          shapes={shapes}
          tool={tool}
          selectedIds={selectedIds}
          onSelect={setSelectedIds}
          onCreateAt={create}
          onCreateSized={createSized}
          onFreehand={createFreehand}
          onEditText={startTextEdit}
          onMove={moveShape}
          onTransform={(id, t) =>
            patchShape(id, {
              x: t.x,
              y: t.y,
              w: t.w,
              h: t.h,
              rotation: t.rotation,
            })
          }
          peers={peers}
          onCursorMove={(x, y) => setLocal({ x, y }, selectedIds)}
          onCursorLeave={() => setLocal(undefined, selectedIds)}
          width={canvasSize.width}
          height={canvasSize.height}
        />
      </div>
    </div>
  );
}
