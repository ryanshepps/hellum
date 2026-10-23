import { readFileSync } from "node:fs";
import { join } from "node:path";

type HistoryEntry =
  | { role: "user"; text: string }
  | { role: "assistant"; text: string }
  | { role: "tool"; name: string; context: string };

type StoredSession = { title: string; startedAt: number; history: HistoryEntry[]; source: string };

type Request = { id: string; method: string; params: Record<string, string | undefined> };

const stored = new Map<string, StoredSession>();
const liveToStored = new Map<string, string>();
const running = new Map<string, { resumeApproval: (() => void) | null; interrupted: boolean }>();
let counter = 0;

function write(frame: object): void {
  process.stdout.write(`${JSON.stringify(frame)}\n`);
}

function emit(type: string, sid: string, payload?: object): void {
  write({ jsonrpc: "2.0", method: "event", params: { type, session_id: sid, ...(payload ? { payload } : {}) } });
}

function ok(id: string, result: object): void {
  write({ jsonrpc: "2.0", id, result });
}

function fail(id: string, code: number, message: string): void {
  write({ jsonrpc: "2.0", id, error: { code, message } });
}

function openLive(storedId: string): string {
  counter += 1;
  const sid = `live${counter}`;
  liveToStored.set(sid, storedId);
  return sid;
}

function traceFrames(name: string): { type: string; payload: Record<string, unknown> | undefined }[] {
  return readFileSync(join(import.meta.dir, "../fixtures/hermes-traces", `${name}.jsonl`), "utf8")
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line).params);
}

async function runTurn(sid: string, session: StoredSession, text: string): Promise<void> {
  const turn = { resumeApproval: null as (() => void) | null, interrupted: false };
  running.set(sid, turn);
  const frames = text.startsWith("trace:")
    ? traceFrames(text.slice("trace:".length))
    : [
        { type: "message.start", payload: undefined },
        { type: "message.delta", payload: { text: `echo: ${text}` } },
        { type: "message.complete", payload: { text: `echo: ${text}`, status: "complete" } },
      ];
  for (const frame of frames) {
    await Bun.sleep(1);
    if (turn.interrupted) {
      emit("message.complete", sid, { text: "", status: "interrupted" });
      break;
    }
    emit(frame.type, sid, frame.payload);
    if (frame.type === "tool.start") {
      session.history.push({ role: "tool", name: String(frame.payload?.name), context: String(frame.payload?.context) });
    }
    if (frame.type === "approval.request") {
      await new Promise<void>((resolve) => {
        turn.resumeApproval = resolve;
      });
    }
    if (frame.type === "message.complete") {
      session.history.push({ role: "assistant", text: String(frame.payload?.text) });
      if (!session.title) {
        session.title = `About ${session.history[0]?.role === "user" ? session.history[0].text.slice(0, 20) : "chat"}`;
      }
    }
  }
  running.delete(sid);
}

function handle({ id, method, params }: Request): void {
  const sid = params.session_id ?? "";
  const storedId = liveToStored.get(sid) ?? "";
  const session = stored.get(storedId);
  switch (method) {
    case "session.create": {
      counter += 1;
      const newStoredId = `fake_${counter}`;
      stored.set(newStoredId, { title: "", startedAt: Date.now() / 1000, history: [], source: params.source ?? "tui" });
      return ok(id, { session_id: openLive(newStoredId), stored_session_id: newStoredId, message_count: 0 });
    }
    case "session.list":
      return ok(id, {
        sessions: [...stored.entries()].map(([key, value]) => ({
          id: key,
          title: value.title,
          preview: value.history[0]?.role === "user" ? value.history[0].text : "",
          started_at: value.startedAt,
          message_count: value.history.length,
          source: value.source,
        })),
      });
    case "session.resume":
      return stored.has(sid)
        ? ok(id, { session_id: openLive(sid), stored_session_id: sid, message_count: stored.get(sid)?.history.length ?? 0 })
        : fail(id, 4007, "session not found");
    case "session.history":
      return session ? ok(id, { count: session.history.length, messages: session.history }) : fail(id, 4001, "session not found");
    case "session.title":
      if (!session) return fail(id, 4001, "session not found");
      if (params.title) session.title = params.title;
      return ok(id, { title: session.title });
    case "prompt.submit":
      if (!session) return fail(id, 4001, "session not found");
      if (params.text === "crash") process.exit(3);
      session.history.push({ role: "user", text: params.text ?? "" });
      ok(id, { status: "streaming" });
      void runTurn(sid, session, params.text ?? "");
      return;
    case "approval.respond": {
      const turn = running.get(sid);
      turn?.resumeApproval?.();
      return ok(id, { resolved: Boolean(turn) });
    }
    case "session.interrupt": {
      const turn = running.get(sid);
      if (turn) turn.interrupted = true;
      turn?.resumeApproval?.();
      return ok(id, { status: "interrupted" });
    }
    case "session.close":
      liveToStored.delete(sid);
      return ok(id, { closed: true });
    case "session.delete":
      return stored.delete(sid) ? ok(id, { deleted: sid }) : fail(id, 4007, "session not found");
    default:
      return fail(id, -32601, `unknown method ${method}`);
  }
}

write({ jsonrpc: "2.0", method: "event", params: { type: "gateway.ready", payload: {} } });
let buffered = "";
for await (const chunk of Bun.stdin.stream()) {
  buffered += new TextDecoder().decode(chunk);
  const lines = buffered.split("\n");
  buffered = lines.pop() ?? "";
  for (const line of lines.filter((candidate) => candidate.trim())) {
    handle(JSON.parse(line));
  }
}
