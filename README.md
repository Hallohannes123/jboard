# CRDT Whiteboard

Ein kleiner Prototyp für ein gemeinsames Whiteboard. Yjs, Automerge und Loro
liegen hinter demselben Interface.

## Aufbau

- app/ - React-Oberfläche mit Konva, Presence und lokaler Speicherung
- crdt/ - gemeinsames Modell und Adapter
- server/ - WebSocket-Relay für Dokumente und Presence
- bench/ - spätere Benchmarks

## Start

Node 20 und pnpm 10 werden erwartet.

    pnpm install
    pnpm build
    pnpm --filter @wb/server start
    pnpm --filter @wb/app dev

Tests laufen mit:

    pnpm test
