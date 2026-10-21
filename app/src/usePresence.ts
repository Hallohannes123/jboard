import { useEffect, useRef, useState } from "react";
import type { PresenceState } from "@wb/crdt";
import { RelayPresence } from "./presence.js";

const RELAY = import.meta.env.VITE_RELAY ?? "ws://localhost:8787";

export function usePresence(room: string, identity: { name: string; color: string }) {
  const chanRef = useRef<RelayPresence | null>(null);
  const [peers, setPeers] = useState<Map<string, PresenceState>>(new Map());

  const peerIdRef = useRef<string | null>(null);
  if (peerIdRef.current === null) peerIdRef.current = crypto.randomUUID();

  useEffect(() => {
    const chan = new RelayPresence(`${RELAY}/presence/${room}`, peerIdRef.current!);
    chan.onRemote(setPeers);
    chanRef.current = chan;
    return () => {
      chan.close();
      chanRef.current = null;
      setPeers(new Map());
    };
  }, [room]);

  const setLocal = (cursor: { x: number; y: number } | undefined, selection: string[]) => {
    const state: PresenceState = { ...identity, selection };
    if (cursor !== undefined) state.cursor = cursor;
    chanRef.current?.setLocal(state);
  };

  return { peers, setLocal };
}
