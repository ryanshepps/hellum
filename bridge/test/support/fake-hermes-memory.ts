import { existsSync, readFileSync, writeFileSync } from "node:fs";

type Store = { memory: string[]; user: string[] };

export type MemoryRequest = { action: string; target: "memory" | "user"; content?: string; old_text?: string };

const LIMITS = { memory: 2200, user: 1375 } as const;

export function handleMemory(request: MemoryRequest): object {
  const stateFile = process.env.FAKE_HERMES_MEMORY_FILE ?? "";
  const store: Store = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, "utf8")) : { memory: [], user: [] };
  const save = () => writeFileSync(stateFile, JSON.stringify(store));
  const entries = store[request.target] ?? [];
  switch (request.action) {
    case "list":
      return { success: true, ...store, limits: LIMITS, modified: { memory: store.memory.length ? 1_792_000_000 : null, user: store.user.length ? 1_792_000_000 : null } };
    case "add": {
      const content = (request.content ?? "").trim();
      if ([...entries, content].join("\n§\n").length > LIMITS[request.target]) {
        return { success: false, error: "Memory at capacity" };
      }
      entries.push(content);
      save();
      return { success: true };
    }
    case "replace":
    case "remove": {
      const index = entries.findIndex((entry) => entry.includes(request.old_text ?? ""));
      if (index === -1) {
        return { success: false, error: "No entry matched" };
      }
      if (request.action === "replace") {
        entries[index] = (request.content ?? "").trim();
      } else {
        entries.splice(index, 1);
      }
      save();
      return { success: true };
    }
    default:
      return { success: false, error: `unknown action ${request.action}` };
  }
}
