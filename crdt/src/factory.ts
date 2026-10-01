import type { CrdtBackend } from "./backend.js";
import { YjsBackend } from "./adapters/yjs.js";
import { LoroBackend } from "./adapters/loro.js";
import { AutomergeBackend } from "./adapters/automerge.js";

export function createBackend(kind: CrdtBackend["kind"]): CrdtBackend {
  switch (kind) {
    case "yjs":
      return new YjsBackend();
    case "automerge":
      return new AutomergeBackend();
    case "loro":
      return new LoroBackend();
  }
}
