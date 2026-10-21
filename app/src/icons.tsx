import type { ShapeKind } from "@wb/crdt";

export type Tool = ShapeKind | "select";

const box = { width: 16, height: 16, viewBox: "0 0 16 16", fill: "none" as const };
const stroke = {
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

const GLYPHS: Record<Tool, React.ReactNode> = {
  select: <path d="M3 2l8 6-3.5.8L9 12.5 7.3 13 5.5 9 3 10.5z" {...stroke} />,
  rect: <rect x={2.5} y={4} width={11} height={8} rx={1} {...stroke} />,
  ellipse: <ellipse cx={8} cy={8} rx={5.5} ry={4} {...stroke} />,
  line: <line x1={3} y1={13} x2={13} y2={3} {...stroke} />,
  draw: <path d="M2.5 11c2-4 3.5 1 5.5-1s2.5-5 5.5-4.5" {...stroke} />,
  text: (
    <>
      <path d="M4 4h8M8 4v9" {...stroke} />
    </>
  ),
};

export function ToolIcon({ kind }: { kind: Tool }) {
  return (
    <svg {...box} aria-hidden="true">
      {GLYPHS[kind]}
    </svg>
  );
}
