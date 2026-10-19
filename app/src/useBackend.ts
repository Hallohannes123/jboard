import { useCallback, useEffect, useRef, useState } from "react";
import { createBackend, keyAfter, type CrdtBackend, type Shape, type ShapeId } from "@wb/crdt";
import { DocTransport } from "./transport.js";
import { SnapshotStore } from "./store.js";

export type BackendKind = CrdtBackend["kind"];

const RELAY = import.meta.env.VITE_RELAY ?? "ws://localhost:8787";
const SAVE_DEBOUNCE = 500;

const store = new SnapshotStore();

export function useBackend(kind: BackendKind, room = "main") {
  const backendRef = useRef<CrdtBackend | null>(null);
  const [shapes, setShapes] = useState<Shape[]>([]);

  useEffect(() => {
    const be = createBackend(kind);
    backendRef.current = be;
    const docKey = `${room}-${kind}`;
    const project = () => setShapes(be.getAllShapes());

    // beim zeichnen nicht für jeden kleinen schritt speichern
    let saveTimer: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;
    const persist = () => {
      if (saveTimer !== null) clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        if (!disposed) void store.save(docKey, be.getSnapshot());
      }, SAVE_DEBOUNCE);
    };

    const off = be.subscribe(() => {
      project();
      persist();
    });

    // gespeicherten stand für die gewählte library laden
    void store.load(docKey).then((snap) => {
      if (disposed || snap === undefined) return;
      be.load(snap);
      project();
    });

    const transport = new DocTransport(`${RELAY}/doc/${docKey}`, be);
    project();
    return () => {
      disposed = true;
      if (saveTimer !== null) clearTimeout(saveTimer);
      off();
      transport.close();
      backendRef.current = null;
    };
  }, [kind, room]);

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

  const patchShape = useCallback((id: ShapeId, patch: Partial<Shape>): void => {
    backendRef.current?.patchShape(id, patch);
  }, []);

  const undo = useCallback((): void => backendRef.current?.undo(), []);
  const redo = useCallback((): void => backendRef.current?.redo(), []);

  return { shapes, addShape, moveShape, deleteShape, patchShape, undo, redo };
}
