# CRDT Whiteboard

Ein kleiner Prototyp für ein gemeinsames Whiteboard. Yjs, Automerge und Loro
liegen hinter demselben Interface.

## Aufbau

- app/ - React-Oberfläche mit Konva
- crdt/ - gemeinsames Modell und Adapter
- server/ - späterer WebSocket-Relay
- bench/ - spätere Benchmarks

## Start

Node 20 und pnpm 10 werden erwartet.

    pnpm install
    pnpm build
    pnpm --filter @wb/app dev

Tests laufen mit:

    pnpm test
