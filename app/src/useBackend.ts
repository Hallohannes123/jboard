import { useCallback, useEffect, useRef, useState } from "react";
import { createBackend, keyAfter, type CrdtBackend, type Shape, type ShapeId } from "@wb/crdt";
import { DocTransport, type ConnStatus } from "./transport.js";
import { SnapshotStore } from "./store.js";

export type BackendKind = CrdtBackend["kind"];

export interface LiveMetrics {
  lastUpdateB: number;
  lastApplyMs: number;
  docSizeB: number;
}

const RELAY = import.meta.env.VITE_RELAY ?? "ws://localhost:8787";
const SAVE_DEBOUNCE = 500;

const store = new SnapshotStore();

export function useBackend(kind: BackendKind, room = "main") {
  const backendRef = useRef<CrdtBackend | null>(null);
  const [shapes, setShapes] = useState<Shape[]>([]);
  const [metrics, setMetrics] = useState<LiveMetrics>({
    lastUpdateB: 0,
    lastApplyMs: 0,
    docSizeB: 0,
  });

  const [status, setStatus] = useState<ConnStatus>("connecting");

  const lastUpdateB = useRef(0);

  useEffect(() => {
    const be = createBackend(kind);
    backendRef.current = be;
    lastUpdateB.current = 0;
    setMetrics({ lastUpdateB: 0, lastApplyMs: 0, docSizeB: 0 });
    setStatus("connecting");

    const docKey = `${room}-${kind}`;
    const project = () => setShapes(be.getAllShapes());

    let saveTimer: ReturnType<typeof setTimeout> | null = null;
    let savePending = false;
    let disposed = false;
    const persist = () => {
      savePending = true;
      if (saveTimer !== null) clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        saveTimer = null;
        savePending = false;
        if (!disposed) void store.save(docKey, be.getSnapshot());
      }, SAVE_DEBOUNCE);
    };

    const off = be.subscribe(() => {
      project();
      persist();

      setMetrics((m) => ({
        ...m,
        lastUpdateB: lastUpdateB.current,
        docSizeB: be.getSnapshot().byteLength,
      }));
    });

    void store.load(docKey).then((snap) => {
      if (disposed || snap === undefined) return;
      be.load(snap);
      project();
    });

    const transport = new DocTransport(
      `${RELAY}/doc/${docKey}`,
      be,
      (bytes) => {
        lastUpdateB.current = bytes;
      },
      (s) => {
        if (!disposed) setStatus(s);
      },
    );
    project();
    return () => {
      disposed = true;
      if (saveTimer !== null) clearTimeout(saveTimer);

      if (savePending) void store.save(docKey, be.getSnapshot());
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

  const timed = useCallback((fn: () => void): void => {
    const t0 = performance.now();
    fn();
    const dt = performance.now() - t0;
    setMetrics((m) => ({ ...m, lastApplyMs: dt }));
  }, []);

  const addShape = useCallback(
    (partial: Omit<Shape, "z">): void => {
      const be = backendRef.current;
      if (be === null) return;
      timed(() => be.putShape({ ...partial, z: topZ() } as Shape));
    },
    [topZ, timed],
  );

  const moveShape = useCallback(
    (id: ShapeId, x: number, y: number): void => {
      timed(() => backendRef.current?.patchShape(id, { x, y }));
    },
    [timed],
  );

  const deleteShape = useCallback(
    (id: ShapeId): void => {
      timed(() => backendRef.current?.deleteShape(id));
    },
    [timed],
  );

  const patchShape = useCallback(
    (id: ShapeId, patch: Partial<Shape>): void => {
      timed(() => backendRef.current?.patchShape(id, patch));
    },
    [timed],
  );

  const undo = useCallback((): void => backendRef.current?.undo(), []);
  const redo = useCallback((): void => backendRef.current?.redo(), []);

  return { shapes, addShape, moveShape, deleteShape, patchShape, undo, redo, metrics, status };
}
