import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

type HistoryEntry =
  | { role: "user"; text: string; timestamp: number; row_id: number }
  | { role: "assistant"; text: string; timestamp: number; row_id: number }
  | { role: "tool"; name: string; context: string; timestamp: number };

type StoredSession = {
  title: string;
  startedAt: number;
  history: HistoryEntry[];
  source: string;
  revision: number;
  generation: number;
};

type Params = Record<string, unknown>;

type Request = { id: string; method: string; params: Params };

type Response = { id: string; result?: { value?: string } };

type PendingControl = { promptId: string; generation: number; answer: (value: string) => void };

const SURFACES = new Set(["cli", "tui", "gui", "acp", "tool", "oneshot"]);

const stored = new Map<string, StoredSession>();
const subscriptions = new Map<string, string>();
const running = new Map<string, { interrupted: boolean; settle: (() => void) | null }>();
const pendingImages = new Map<string, number>();
const pendingControls = new Map<string, PendingControl>();
const pendingRequests = new Map<string, (value: string) => void>();
let counter = 0;
let rowCounter = 0;

function persistSessions(): void {
  const path = process.env.FAKE_HERMES_GATEWAY_STATE_FILE;
  if (!path) {
    return;
  }
  const rows = [...stored.entries()].map(([id, session]) => ({
    id,
    title: session.title,
    preview: session.history[0]?.role === "user" ? session.history[0].text : "",
    started_at: session.startedAt,
    message_count: session.history.length,
    source: session.source,
    runtime_revision: session.revision,
    runtime_generation: session.generation,
  }));
  writeFileSync(path, JSON.stringify(rows));
}

function write(frame: object): void {
  process.stdout.write(`${JSON.stringify(frame)}\n`);
}

function emit(type: string, sid: string, payload?: object): void {
  write({ jsonrpc: "2.0", method: "event", params: { type, session_id: sid, ...(payload ? { payload } : {}) } });
}

function ok(id: string, result: object): void {
  write({ jsonrpc: "2.0", id, result });
}

function fail(id: string, code: number, message: string, data: object = {}): void {
  write({ jsonrpc: "2.0", id, error: { code, message, data: { reason: message, ...data } } });
}

function text(params: Params, key: string): string {
  const value = params[key];
  return typeof value === "string" ? value : "";
}

function nextId(prefix: string): string {
  counter += 1;
  return `${prefix}${counter}`;
}

function record(session: StoredSession, entry: Omit<Extract<HistoryEntry, { role: "user" | "assistant" }>, "timestamp" | "row_id">): void {
  rowCounter += 1;
  session.history.push({ ...entry, timestamp: Date.now() / 1000, row_id: rowCounter });
}

function snapshot(sid: string, session: StoredSession): object {
  const subscriptionId = nextId("sub");
  subscriptions.set(sid, subscriptionId);
  return {
    session_id: sid,
    stored_session_id: sid,
    subscription_id: subscriptionId,
    revision: session.revision,
    execution_generation: session.generation,
    message_count: session.history.length,
    messages: [],
    running: running.has(sid),
  };
}

function traceFrames(name: string): { type: string; payload: Record<string, unknown> | undefined }[] {
  return readFileSync(join(import.meta.dir, "../fixtures/hermes-traces", `${name}.jsonl`), "utf8")
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line).params);
}

function askControl(sid: string, session: StoredSession, type: string, payload: object): Promise<string> {
  const promptId = nextId("prompt");
  return new Promise((resolve) => {
    pendingControls.set(promptId, { promptId, generation: session.generation, answer: resolve });
    emit(type, sid, { ...payload, prompt_id: promptId, execution_generation: session.generation });
  });
}

function askViewer(sid: string, method: string, params: object): Promise<string> {
  const requestId = nextId("srq-");
  return new Promise((resolve) => {
    pendingRequests.set(requestId, resolve);
    write({ jsonrpc: "2.0", id: requestId, method, params: { session_id: sid, ...params } });
  });
}

async function promptReply(sid: string, session: StoredSession, prompt: string): Promise<string | null> {
  if (prompt.startsWith("ask:")) {
    const [question = "", choices = ""] = prompt.slice("ask:".length).split("|");
    const answer = await askControl(sid, session, "clarify.request", { kind: "clarify", question, choices: choices ? choices.split(",") : [] });
    return `you said: ${answer || "(nothing)"}`;
  }
  if (prompt.startsWith("secret:")) {
    const value = await askViewer(sid, "secret", { prompt: "Paste your key", env_var: prompt.slice("secret:".length) });
    return value ? `stored ${value.length} characters` : "skipped";
  }
  if (prompt === "sudo:") {
    const password = await askViewer(sid, "sudo", { command: "sudo true" });
    return password ? "authenticated" : "skipped";
  }
  return null;
}

async function runTurn(sid: string, session: StoredSession, prompt: string): Promise<void> {
  const turn = { interrupted: false, settle: null as (() => void) | null };
  running.set(sid, turn);
  session.generation += 1;
  const images = pendingImages.get(sid) ?? 0;
  pendingImages.delete(sid);
  if (!prompt.startsWith("trace:")) {
    emit("message.start", sid);
  }
  const reply = (await promptReply(sid, session, prompt)) ?? `echo: ${prompt}${images > 0 ? ` [images:${images}]` : ""}`;
  const frames = prompt.startsWith("trace:")
    ? traceFrames(prompt.slice("trace:".length))
    : [
        { type: "message.delta", payload: { text: reply } },
        { type: "message.complete", payload: { text: reply, status: "complete" } },
      ];
  for (const frame of frames) {
    await Bun.sleep(1);
    if (turn.interrupted) {
      emit("message.complete", sid, { text: "", status: "interrupted" });
      break;
    }
    if (frame.type === "approval.request") {
      await new Promise<void>((resolve) => {
        turn.settle = resolve;
        void askControl(sid, session, "approval.request", { kind: "approval", ...frame.payload, choices: ["once", "deny"] }).then(() => resolve());
      });
      continue;
    }
    emit(frame.type, sid, frame.payload);
    if (frame.type === "tool.start") {
      session.history.push({ role: "tool", name: String(frame.payload?.name), context: String(frame.payload?.context), timestamp: Date.now() / 1000 });
    }
    if (frame.type === "message.complete") {
      if (prompt.startsWith("limit:")) {
        record(session, { role: "user", text: "You've reached the maximum number of tool-calling iterations allowed." });
      }
      record(session, { role: "assistant", text: String(frame.payload?.text) });
      if (!session.title) {
        session.title = `About ${session.history[0]?.role === "user" ? session.history[0].text.slice(0, 20) : "chat"}`;
      }
    }
  }
  running.delete(sid);
  persistSessions();
}

function answerControl(id: string, params: Params, value: string): void {
  const control = pendingControls.get(text(params, "prompt_id"));
  if (!control || control.generation !== params.execution_generation) {
    return fail(id, 4001, "stale_generation");
  }
  pendingControls.delete(control.promptId);
  control.answer(value);
  return ok(id, { resolved: true });
}

function mutate(id: string, sid: string, session: StoredSession, params: Params): void {
  if (params.operation === "delete" && typeof params.expected_generation !== "number") {
    return fail(id, 4001, "invalid_params");
  }
  const generationMatches = params.expected_generation === undefined || params.expected_generation === session.generation;
  if (params.expected_revision !== session.revision || !generationMatches) {
    return fail(id, 4001, "revision_conflict", { revision: session.revision, execution_generation: session.generation });
  }
  const payload = (params.payload ?? {}) as Params;
  switch (params.operation) {
    case "rename":
      session.title = text(payload, "title");
      session.revision += 1;
      return ok(id, { session_id: sid, revision: session.revision });
    case "delete":
      stored.delete(sid);
      subscriptions.delete(sid);
      return ok(id, { session_id: sid, deleted: true });
    default:
      return fail(id, 4001, "invalid_params");
  }
}

function handle({ id, method, params }: Request): void {
  const sid = text(params, "session_id");
  const session = stored.get(sid);
  switch (method) {
    case "session.create": {
      if (!text(params, "request_id") || !SURFACES.has(text(params, "source"))) {
        return fail(id, 4001, "invalid_params");
      }
      const newId = nextId("fake_");
      const created: StoredSession = { title: "", startedAt: Date.now() / 1000, history: [], source: "local", revision: 0, generation: 0 };
      stored.set(newId, created);
      return ok(id, snapshot(newId, created));
    }
    case "session.resume":
      return session ? ok(id, snapshot(sid, session)) : fail(id, 4001, "not_found");
    case "session.history":
      return session ? ok(id, { count: session.history.length, messages: session.history }) : fail(id, 4001, "not_found");
    case "session.detach": {
      const attached = subscriptions.get(sid) === text(params, "subscription_id");
      if (attached) subscriptions.delete(sid);
      return ok(id, { session_id: sid, subscription_id: text(params, "subscription_id"), detached: attached });
    }
    case "session.mutate":
      return session ? mutate(id, sid, session, params) : fail(id, 4001, "not_found");
    case "prompt.submit": {
      if (!session || !subscriptions.has(sid)) return fail(id, 4001, "permission_denied");
      if (!text(params, "submission_id")) return fail(id, 4001, "invalid_params");
      const prompt = text(params, "text");
      if (prompt === "crash") process.exit(3);
      record(session, { role: "user", text: prompt });
      ok(id, { admission_id: nextId("adm"), status: "queued" });
      void runTurn(sid, session, prompt);
      return;
    }
    case "image.attach_bytes":
      if (!session) return fail(id, 4001, "not_found");
      pendingImages.set(sid, (pendingImages.get(sid) ?? 0) + 1);
      return ok(id, { attached: true, count: pendingImages.get(sid) });
    case "file.attach":
      if (!session) return fail(id, 4001, "not_found");
      return ok(id, { attached: true, name: text(params, "name"), ref_text: `@file:uploads/${text(params, "name")}` });
    case "approval.respond":
      return answerControl(id, params, text(params, "choice"));
    case "clarify.respond":
      return answerControl(id, params, text(params, "answer"));
    case "config.set":
      return text(params, "key") === "model" ? fail(id, 4001, "use_session_mutation_model") : ok(id, { key: text(params, "key") });
    case "reload.env":
      return ok(id, { updated: 1 });
    case "session.interrupt": {
      if (!session) return fail(id, 4001, "not_found");
      if (params.execution_generation !== session.generation) {
        return fail(id, 4001, "stale_generation", { execution_generation: session.generation });
      }
      const turn = running.get(sid);
      if (turn) turn.interrupted = true;
      turn?.settle?.();
      return ok(id, { session_id: sid, execution_generation: session.generation });
    }
    default:
      return fail(id, -32601, `unknown method: ${method}`);
  }
}

function settleRequest(response: Response): void {
  const answer = pendingRequests.get(response.id);
  pendingRequests.delete(response.id);
  answer?.(response.result?.value ?? "");
}

write({ jsonrpc: "2.0", method: "event", params: { type: "gateway.ready", payload: {} } });
let buffered = "";
for await (const chunk of Bun.stdin.stream()) {
  buffered += new TextDecoder().decode(chunk);
  const lines = buffered.split("\n");
  buffered = lines.pop() ?? "";
  for (const line of lines.filter((candidate) => candidate.trim())) {
    const frame = JSON.parse(line);
    if (typeof frame.method === "string") {
      handle({ id: frame.id, method: frame.method, params: frame.params ?? {} });
    } else {
      settleRequest(frame);
    }
    persistSessions();
  }
}
