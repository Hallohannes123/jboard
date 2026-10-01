import { useCallback, useEffect, useRef, useState } from "react";
import { createBackend, keyAfter, type CrdtBackend, type Shape, type ShapeId } from "@wb/crdt";

export type BackendKind = CrdtBackend["kind"];

export function useBackend(kind: BackendKind) {
  const backendRef = useRef<CrdtBackend | null>(null);
  const [shapes, setShapes] = useState<Shape[]>([]);

  // wechsel startet mit einem frischen dokument
  useEffect(() => {
    const be = createBackend(kind);
    backendRef.current = be;
    const project = () => setShapes(be.getAllShapes());
    const off = be.subscribe(project);
    project();
    return () => {
      off();
      backendRef.current = null;
    };
  }, [kind]);

  const topZ = useCallback((): string => {
    const list = backendRef.current?.getAllShapes() ?? [];
    const last = list[list.length - 1];
    return keyAfter(last ? last.z : null);
  }, []);

  const addShape = useCallback(
    (partial: Omit<Shape, "z">): void => {
      const be = backendRef.current;
      if (be === null) return;
      be.putShape({ ...partial, z: topZ() } as Shape);
    },
    [topZ],
  );

  const moveShape = useCallback((id: ShapeId, x: number, y: number): void => {
    backendRef.current?.patchShape(id, { x, y });
  }, []);

  const deleteShape = useCallback((id: ShapeId): void => {
    backendRef.current?.deleteShape(id);
  }, []);

  const undo = useCallback((): void => backendRef.current?.undo(), []);
  const redo = useCallback((): void => backendRef.current?.redo(), []);

  return { shapes, addShape, moveShape, deleteShape, undo, redo };
}
