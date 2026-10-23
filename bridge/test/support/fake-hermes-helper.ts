import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";

type Store = { memory: string[]; user: string[] };

const LIMITS = { memory: 2200, user: 1375 } as const;
const helper = basename(process.argv[2] ?? "", ".py");
const stateFile = process.env.FAKE_HERMES_MEMORY_FILE ?? "";
const store: Store = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, "utf8")) : { memory: [], user: [] };
const request = JSON.parse(await Bun.stdin.text()) as { action: string; target: "memory" | "user"; content?: string; old_text?: string };

function save(): void {
  writeFileSync(stateFile, JSON.stringify(store));
}

function respond(result: object): void {
  process.stdout.write(JSON.stringify(result));
}

if (helper !== "memory") {
  process.stderr.write(`unknown helper ${helper}\n`);
  process.exit(2);
}

const entries = store[request.target] ?? [];
switch (request.action) {
  case "list":
    respond({ success: true, ...store, limits: LIMITS, modified: { memory: store.memory.length ? 1_792_000_000 : null, user: store.user.length ? 1_792_000_000 : null } });
    break;
  case "add": {
    const content = (request.content ?? "").trim();
    if ([...entries, content].join("\n§\n").length > LIMITS[request.target]) {
      respond({ success: false, error: "Memory at capacity" });
      break;
    }
    entries.push(content);
    save();
    respond({ success: true });
    break;
  }
  case "replace": {
    const index = entries.findIndex((entry) => entry.includes(request.old_text ?? ""));
    if (index === -1) {
      respond({ success: false, error: "No entry matched" });
      break;
    }
    entries[index] = (request.content ?? "").trim();
    save();
    respond({ success: true });
    break;
  }
  case "remove": {
    const index = entries.findIndex((entry) => entry.includes(request.old_text ?? ""));
    if (index === -1) {
      respond({ success: false, error: "No entry matched" });
      break;
    }
    entries.splice(index, 1);
    save();
    respond({ success: true });
    break;
  }
  default:
    respond({ success: false, error: `unknown action ${request.action}` });
}
