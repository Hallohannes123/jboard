import { useEffect, useMemo, useRef, useState } from "react";
import { Stage, Layer, Rect, Ellipse, Line, Text, Transformer } from "react-konva";
import type Konva from "konva";
import type { PresenceState, Shape, ShapeId, ShapeKind } from "@wb/crdt";
import type { Tool } from "./icons.js";

const MIN_SIZE = 5;
const SELECT_STROKE = "#2563eb";
const SELECT_STROKE_BUMP = 2;
const CURSOR_OFFSET = 8;
const CURSOR_FONT = 12;
const DRAG_THRESHOLD = 4;

export type Transform = {
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
};

export type SizedSpec = {
  kind: ShapeKind;
  x: number;
  y: number;
  w: number;
  h: number;
  points?: number[];
};

type Props = {
  shapes: Shape[];
  tool: Tool;
  selectedIds: ShapeId[];
  onSelect: (ids: ShapeId[]) => void;
  onCreateAt: (x: number, y: number) => void;
  onCreateSized: (spec: SizedSpec) => void;
  onFreehand: (x: number, y: number, points: number[]) => void;
  onEditText: (id: ShapeId, x: number, y: number) => void;
  onMove: (id: ShapeId, x: number, y: number) => void;
  onTransform: (id: ShapeId, t: Transform) => void;
  peers: Map<string, PresenceState>;
  onCursorMove: (x: number, y: number) => void;
  onCursorLeave: () => void;
  width: number;
  height: number;
};

export function Canvas({
  shapes,
  tool,
  selectedIds,
  onSelect,
  onCreateAt,
  onCreateSized,
  onFreehand,
  onEditText,
  onMove,
  onTransform,
  peers,
  onCursorMove,
  onCursorLeave,
  width,
  height,
}: Props) {
  const nodeRefs = useRef(new Map<ShapeId, Konva.Node>());
  const trRef = useRef<Konva.Transformer>(null);
  const stageRef = useRef<Konva.Stage>(null);

  const shapeById = useMemo(() => new Map(shapes.map((s) => [s.id, s])), [shapes]);

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  const drawing = useRef<{ originX: number; originY: number } | null>(null);
  const drawPointsRef = useRef<number[] | null>(null);
  const [drawPoints, setDrawPoints] = useState<number[] | null>(null);

  const sizing = useRef<{
    kind: ShapeKind;
    originX: number;
    originY: number;
    curX: number;
    curY: number;
  } | null>(null);
  const [sizeRect, setSizeRect] = useState<{ x: number; y: number; w: number; h: number } | null>(
    null,
  );

  const marquee = useRef<{ originX: number; originY: number } | null>(null);
  const [marqueeRect, setMarqueeRect] = useState<{
    x: number;
    y: number;
    w: number;
    h: number;
  } | null>(null);

  useEffect(() => {
    const tr = trRef.current;
    if (tr === null) return;
    const nodes = selectedIds
      .map((id) => nodeRefs.current.get(id))
      .filter((n): n is Konva.Node => n !== undefined);
    const single = selectedIds.length === 1;
    const selKind = single ? shapes.find((s) => s.id === selectedIds[0])?.kind : undefined;
    const pathBased = selKind === "line" || selKind === "draw";
    const resizable = single && !pathBased;
    tr.enabledAnchors(resizable ? ["top-left", "top-right", "bottom-left", "bottom-right"] : []);
    tr.nodes(nodes);
    tr.getLayer()?.batchDraw();
  }, [selectedIds, shapes]);

  useEffect(() => {
    const container = stageRef.current?.container();
    if (container) container.style.cursor = "crosshair";
  }, [shapes, selectedIds]);

  const handleStageMouseDown = (e: Konva.KonvaEventObject<MouseEvent>) => {
    if (e.target !== e.target.getStage()) return;
    const pos = e.target.getStage()?.getPointerPosition();
    if (pos === null || pos === undefined) {
      onSelect([]);
      return;
    }

    if (tool === "select") {
      onSelect([]);
      marquee.current = { originX: pos.x, originY: pos.y };
      setMarqueeRect({ x: pos.x, y: pos.y, w: 0, h: 0 });
      return;
    }

    if (tool === "draw") {
      drawing.current = { originX: pos.x, originY: pos.y };
      drawPointsRef.current = [0, 0];
      setDrawPoints([0, 0]);
      return;
    }

    if (tool === "text") {
      onCreateAt(pos.x, pos.y);
      return;
    }

    sizing.current = { kind: tool, originX: pos.x, originY: pos.y, curX: pos.x, curY: pos.y };
    setSizeRect({ x: pos.x, y: pos.y, w: 0, h: 0 });
  };

  const finishGesture = () => {
    if (marquee.current !== null) {
      const { originX, originY } = marquee.current;
      const stage = stageRef.current;
      const pos = stage?.getPointerPosition() ?? { x: originX, y: originY };
      marquee.current = null;
      setMarqueeRect(null);
      const box = {
        x: Math.min(originX, pos.x),
        y: Math.min(originY, pos.y),
        w: Math.abs(pos.x - originX),
        h: Math.abs(pos.y - originY),
      };

      if (box.w < DRAG_THRESHOLD && box.h < DRAG_THRESHOLD) return;

      const hit = shapes
        .filter(
          (s) =>
            s.x < box.x + box.w && s.x + s.w > box.x && s.y < box.y + box.h && s.y + s.h > box.y,
        )
        .map((s) => s.id);
      onSelect(hit);
      return;
    }

    if (drawing.current !== null) {
      const { originX, originY } = drawing.current;
      const pts = drawPointsRef.current ?? [];
      drawing.current = null;
      drawPointsRef.current = null;
      setDrawPoints(null);

      if (pts.length >= 4) onFreehand(originX, originY, pts);
      return;
    }

    const s = sizing.current;
    if (s === null) return;
    sizing.current = null;
    setSizeRect(null);

    const box = {
      x: Math.min(s.originX, s.curX),
      y: Math.min(s.originY, s.curY),
      w: Math.abs(s.curX - s.originX),
      h: Math.abs(s.curY - s.originY),
    };

    if (box.w < DRAG_THRESHOLD && box.h < DRAG_THRESHOLD) {
      onCreateAt(s.originX, s.originY);
      return;
    }
    if (s.kind === "line") {
      onCreateSized({
        kind: "line",
        x: box.x,
        y: box.y,
        w: box.w,
        h: box.h,
        points: [s.originX - box.x, s.originY - box.y, s.curX - box.x, s.curY - box.y],
      });
    } else {
      onCreateSized({ kind: s.kind, x: box.x, y: box.y, w: box.w, h: box.h });
    }
  };

  const handleStageMouseUp = () => finishGesture();

  useEffect(() => {
    const onUp = () => {
      if (drawing.current !== null || sizing.current !== null || marquee.current !== null)
        finishGesture();
    };
    window.addEventListener("pointerup", onUp);
    return () => window.removeEventListener("pointerup", onUp);
  });

  const bakeTransform = (id: ShapeId, node: Konva.Node) => {
    const shape = shapes.find((s) => s.id === id);
    const pathBased = shape?.kind === "line" || shape?.kind === "draw";
    const rawW = pathBased ? (shape?.w ?? MIN_SIZE) : node.width() * node.scaleX();
    const rawH = pathBased ? (shape?.h ?? MIN_SIZE) : node.height() * node.scaleY();
    const w = Number.isFinite(rawW) ? Math.max(MIN_SIZE, rawW) : (shape?.w ?? MIN_SIZE);
    const h = Number.isFinite(rawH) ? Math.max(MIN_SIZE, rawH) : (shape?.h ?? MIN_SIZE);
    node.scaleX(1);
    node.scaleY(1);
    onTransform(id, {
      x: node.x(),
      y: node.y(),
      w,
      h,
      rotation: (node.rotation() * Math.PI) / 180,
    });
  };

  const handleMouseMove = (e: Konva.KonvaEventObject<MouseEvent>) => {
    const pos = e.target.getStage()?.getPointerPosition();
    if (pos === null || pos === undefined) return;
    onCursorMove(pos.x, pos.y);

    const d = drawing.current;
    if (d !== null) {
      const next = [...(drawPointsRef.current ?? []), pos.x - d.originX, pos.y - d.originY];
      drawPointsRef.current = next;
      setDrawPoints(next);
      return;
    }

    const m = marquee.current;
    if (m !== null) {
      setMarqueeRect({
        x: Math.min(m.originX, pos.x),
        y: Math.min(m.originY, pos.y),
        w: Math.abs(pos.x - m.originX),
        h: Math.abs(pos.y - m.originY),
      });
      return;
    }

    const s = sizing.current;
    if (s !== null) {
      s.curX = pos.x;
      s.curY = pos.y;
      setSizeRect({
        x: Math.min(s.originX, pos.x),
        y: Math.min(s.originY, pos.y),
        w: Math.abs(pos.x - s.originX),
        h: Math.abs(pos.y - s.originY),
      });
    }
  };

  return (
    <Stage
      width={width}
      height={height}
      ref={stageRef}
      onMouseDown={handleStageMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleStageMouseUp}

      onMouseLeave={onCursorLeave}

      style={{ cursor: "crosshair" }}
    >
      <Layer>
        {shapes.map((s) => {
          const isSelected = selectedSet.has(s.id);
          const common = {
            id: s.id,
            x: s.x,
            y: s.y,
            rotation: (s.rotation * 180) / Math.PI,
            fill: s.fill,
            stroke: isSelected ? SELECT_STROKE : s.stroke,
            strokeWidth: isSelected ? s.strokeWidth + SELECT_STROKE_BUMP : s.strokeWidth,
            draggable: true,
            ref: (n: Konva.Node | null) => {
              if (n === null) nodeRefs.current.delete(s.id);
              else nodeRefs.current.set(s.id, n);
            },
            onMouseDown: (e: Konva.KonvaEventObject<MouseEvent>) => {
              e.cancelBubble = true;

              const additive = e.evt.shiftKey || e.evt.metaKey || e.evt.ctrlKey;
              if (additive) {
                onSelect(
                  selectedSet.has(s.id)
                    ? selectedIds.filter((id) => id !== s.id)
                    : [...selectedIds, s.id],
                );
              } else if (!selectedSet.has(s.id)) {
                onSelect([s.id]);
              }
            },
            onMouseEnter: (e: Konva.KonvaEventObject<MouseEvent>) => {
              const c = e.target.getStage()?.container();
              if (c) c.style.cursor = "move";
            },
            onMouseLeave: (e: Konva.KonvaEventObject<MouseEvent>) => {
              const c = e.target.getStage()?.container();
              if (c) c.style.cursor = "crosshair";
            },
            onDblClick: (e: Konva.KonvaEventObject<MouseEvent>) => {
              if (s.kind !== "text") return;
              e.cancelBubble = true;
              onEditText(s.id, s.x, s.y);
            },
            onDragEnd: (e: Konva.KonvaEventObject<DragEvent>) => {
              const nx = e.target.x();
              const ny = e.target.y();

              if (selectedSet.has(s.id) && selectedIds.length > 1) {
                const dx = nx - s.x;
                const dy = ny - s.y;
                for (const id of selectedIds) {
                  const other = shapeById.get(id);
                  if (other !== undefined) onMove(id, other.x + dx, other.y + dy);
                }
              } else {
                onMove(s.id, nx, ny);
              }
            },
            onTransformEnd: (e: Konva.KonvaEventObject<Event>) => {
              bakeTransform(s.id, e.target);
            },
          };

          if (s.kind === "ellipse") {
            return (
              <Ellipse
                key={s.id}
                {...common}
                offsetX={-s.w / 2}
                offsetY={-s.h / 2}
                radiusX={s.w / 2}
                radiusY={s.h / 2}
              />
            );
          }
          if (s.kind === "line" || s.kind === "draw") {
            return <Line key={s.id} {...common} points={s.points ?? []} closed={false} />;
          }
          if (s.kind === "text") {
            return <Text key={s.id} {...common} text={s.text ?? ""} fontSize={s.h} />;
          }
          return <Rect key={s.id} {...common} width={s.w} height={s.h} />;
        })}

        {drawing.current !== null && drawPoints !== null && (
          <Line
            x={drawing.current.originX}
            y={drawing.current.originY}
            points={drawPoints}
            stroke="#111827"
            strokeWidth={2}
            closed={false}
            listening={false}
          />
        )}

        {marquee.current !== null && marqueeRect !== null && (
          <Rect
            x={marqueeRect.x}
            y={marqueeRect.y}
            width={marqueeRect.w}
            height={marqueeRect.h}
            fill="rgba(37, 99, 235, 0.08)"
            stroke={SELECT_STROKE}
            strokeWidth={1}
            dash={[4, 4]}
            listening={false}
          />
        )}

        {sizing.current !== null &&
          sizeRect !== null &&
          (sizing.current.kind === "ellipse" ? (
            <Ellipse
              x={sizeRect.x + sizeRect.w / 2}
              y={sizeRect.y + sizeRect.h / 2}
              radiusX={sizeRect.w / 2}
              radiusY={sizeRect.h / 2}
              stroke={SELECT_STROKE}
              strokeWidth={1}
              dash={[4, 4]}
              listening={false}
            />
          ) : sizing.current.kind === "line" ? (
            <Line
              points={[
                sizing.current.originX,
                sizing.current.originY,
                sizing.current.curX,
                sizing.current.curY,
              ]}
              stroke={SELECT_STROKE}
              strokeWidth={1}
              dash={[4, 4]}
              listening={false}
            />
          ) : (
            <Rect
              x={sizeRect.x}
              y={sizeRect.y}
              width={sizeRect.w}
              height={sizeRect.h}
              stroke={SELECT_STROKE}
              strokeWidth={1}
              dash={[4, 4]}
              listening={false}
            />
          ))}
        <Transformer ref={trRef} />
      </Layer>

      <Layer listening={false}>
        {[...peers.entries()].flatMap(([id, p]) =>
          (p.selection ?? []).flatMap((sid) => {
            const s = shapeById.get(sid);
            if (s === undefined) return [];

            return [
              <Rect
                key={`${id}:${sid}`}
                x={s.x}
                y={s.y}
                width={s.w}
                height={s.h}
                rotation={(s.rotation * 180) / Math.PI}
                stroke={p.color}
                strokeWidth={1.5}
                dash={[6, 4]}
                listening={false}
              />,
            ];
          }),
        )}
        {[...peers.entries()].map(([id, p]) =>
          p.cursor === undefined ? null : (
            <Text
              key={id}
              x={p.cursor.x + CURSOR_OFFSET}
              y={p.cursor.y + CURSOR_OFFSET}
              text={p.name}
              fontSize={CURSOR_FONT}
              fill={p.color}
            />
          ),
        )}
      </Layer>
    </Stage>
  );
}
