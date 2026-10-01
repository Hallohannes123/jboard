import { Stage, Layer, Rect, Ellipse, Line, Text } from "react-konva";
import type Konva from "konva";
import type { Shape, ShapeId } from "@wb/crdt";

type Props = {
  shapes: Shape[];
  selectedId: ShapeId | null;
  onSelect: (id: ShapeId | null) => void;
  onCreateAt: (x: number, y: number) => void;
  onMove: (id: ShapeId, x: number, y: number) => void;
  width: number;
  height: number;
};

export function Canvas({ shapes, selectedId, onSelect, onCreateAt, onMove, width, height }: Props) {
  const handleStageClick = (e: Konva.KonvaEventObject<MouseEvent>) => {
    if (e.target !== e.target.getStage()) return;
    const pos = e.target.getStage()?.getPointerPosition();
    if (pos === null || pos === undefined) {
      onSelect(null);
      return;
    }
    onCreateAt(pos.x, pos.y);
  };

  return (
    <Stage width={width} height={height} onMouseDown={handleStageClick}>
      <Layer>
        {shapes.map((s) => {
          const common = {
            key: s.id,
            x: s.x,
            y: s.y,
            rotation: (s.rotation * 180) / Math.PI,
            fill: s.fill,
            stroke: s.id === selectedId ? "#2563eb" : s.stroke,
            strokeWidth: s.id === selectedId ? s.strokeWidth + 2 : s.strokeWidth,
            draggable: true,
            onMouseDown: (e: Konva.KonvaEventObject<MouseEvent>) => {
              e.cancelBubble = true;
              onSelect(s.id);
            },
            onDragEnd: (e: Konva.KonvaEventObject<DragEvent>) => {
              onMove(s.id, e.target.x(), e.target.y());
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
      </Layer>
    </Stage>
  );
}
