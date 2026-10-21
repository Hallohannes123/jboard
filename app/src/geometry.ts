export function freehandBounds(
  originX: number,
  originY: number,
  points: number[],
): { x: number; y: number; w: number; h: number; points: number[] } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < points.length; i += 2) {
    const px = points[i]!;
    const py = points[i + 1]!;
    if (px < minX) minX = px;
    if (px > maxX) maxX = px;
    if (py < minY) minY = py;
    if (py > maxY) maxY = py;
  }

  if (!Number.isFinite(minX)) {
    return { x: originX, y: originY, w: 1, h: 1, points: points.slice() };
  }
  const rebased: number[] = [];
  for (let i = 0; i < points.length; i += 2) {
    rebased.push(points[i]! - minX, points[i + 1]! - minY);
  }
  return {
    x: originX + minX,
    y: originY + minY,
    w: Math.max(1, maxX - minX),
    h: Math.max(1, maxY - minY),
    points: rebased,
  };
}
