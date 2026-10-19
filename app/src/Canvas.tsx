import { useEffect, useRef } from "react";
import { Stage, Layer, Rect, Ellipse, Line, Text, Transformer } from "react-konva";
import type Konva from "konva";
import type { PresenceState, Shape, ShapeId } from "@wb/crdt";

export type Transform = {
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
};

type Props = {
  shapes: Shape[];
  selectedId: ShapeId | null;
  onSelect: (id: ShapeId | null) => void;
  onCreateAt: (x: number, y: number) => void;
  onMove: (id: ShapeId, x: number, y: number) => void;
  onTransform: (id: ShapeId, t: Transform) => void;
  peers: Map<string, PresenceState>;
  onCursorMove: (x: number, y: number) => void;
  width: number;
  height: number;
};

export function Canvas({
  shapes,
  selectedId,
  onSelect,
  onCreateAt,
  onMove,
  onTransform,
  peers,
  onCursorMove,
  width,
  height,
}: Props) {
  const nodeRefs = useRef(new Map<ShapeId, Konva.Node>());
  const trRef = useRef<Konva.Transformer>(null);

  // transformer an die aktuelle auswahl hängen
  useEffect(() => {
    const tr = trRef.current;
    if (tr === null) return;
    const node = selectedId === null ? undefined : nodeRefs.current.get(selectedId);
    tr.nodes(node ? [node] : []);
    tr.getLayer()?.batchDraw();
  }, [selectedId, shapes]);

  const handleStageClick = (e: Konva.KonvaEventObject<MouseEvent>) => {
    if (e.target !== e.target.getStage()) return;
    const pos = e.target.getStage()?.getPointerPosition();
    if (pos === null || pos === undefined) {
      onSelect(null);
      return;
    }
    onCreateAt(pos.x, pos.y);
  };

  // konva skaliert erst mal nur den node, danach kommen die echten maße ins modell
  const bakeTransform = (id: ShapeId, node: Konva.Node) => {
    const w = Math.max(5, node.width() * node.scaleX());
    const h = Math.max(5, node.height() * node.scaleY());
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
    if (pos !== null && pos !== undefined) onCursorMove(pos.x, pos.y);
  };

  return (
    <Stage
      width={width}
      height={height}
      onMouseDown={handleStageClick}
      onMouseMove={handleMouseMove}
    >
      <Layer>
        {shapes.map((s) => {
          const common = {
            key: s.id,
            id: s.id,
            x: s.x,
            y: s.y,
            rotation: (s.rotation * 180) / Math.PI,
            fill: s.fill,
            stroke: s.id === selectedId ? "#2563eb" : s.stroke,
            strokeWidth: s.id === selectedId ? s.strokeWidth + 2 : s.strokeWidth,
            draggable: true,
            ref: (n: Konva.Node | null) => {
              if (n === null) nodeRefs.current.delete(s.id);
              else nodeRefs.current.set(s.id, n);
            },
            onMouseDown: (e: Konva.KonvaEventObject<MouseEvent>) => {
              e.cancelBubble = true;
              onSelect(s.id);
            },
            onDragEnd: (e: Konva.KonvaEventObject<DragEvent>) => {
              onMove(s.id, e.target.x(), e.target.y());
            },
            onTransformEnd: (e: Konva.KonvaEventObject<Event>) => {
              bakeTransform(s.id, e.target);
            },
          };

          if (s.kind === "ellipse") {
            return <Ellipse {...common} radiusX={s.w / 2} radiusY={s.h / 2} />;
          }
          if (s.kind === "line" || s.kind === "draw") {
            return <Line {...common} points={s.points ?? []} closed={false} />;
          }
          if (s.kind === "text") {
            return <Text {...common} text={s.text ?? ""} fontSize={s.h} />;
          }
          return <Rect {...common} width={s.w} height={s.h} />;
        })}
        <Transformer ref={trRef} />
      </Layer>

      {/* cursor liegen oben und fangen keine klicks ab */}
      <Layer listening={false}>
        {[...peers.entries()].map(([id, p]) =>
          p.cursor === undefined ? null : (
            <Text
              key={id}
              x={p.cursor.x + 8}
              y={p.cursor.y + 8}
              text={p.name}
              fontSize={12}
              fill={p.color}
            />
          ),
        )}
      </Layer>
    </Stage>
  );
}
