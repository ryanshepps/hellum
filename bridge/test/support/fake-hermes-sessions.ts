import { existsSync, readFileSync } from "node:fs";

type Reply = { id: string; source: string; replied_at: number };
type SessionRow = { id: string; title: string; preview: string; started_at: number; message_count: number; source: string };

export type SessionsRequest = { action: string; sources?: string[]; since?: number; session_id?: string; limit?: number };

function readJson<T>(path: string | undefined, empty: T): T {
  return path && existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as T) : empty;
}

export function handleSessions(request: SessionsRequest): object {
  switch (request.action) {
    case "finished_replies": {
      const replies = readJson<Reply[]>(process.env.FAKE_HERMES_SESSIONS_FILE, []);
      const sources = new Set(request.sources ?? []);
      return { success: true, replies: replies.filter((reply) => sources.has(reply.source) && reply.replied_at > (request.since ?? 0)) };
    }
    case "list_sessions": {
      const rows = readJson<SessionRow[]>(process.env.FAKE_HERMES_GATEWAY_STATE_FILE, []);
      return { success: true, sessions: rows.slice(0, request.limit ?? rows.length) };
    }
    case "message_times": {
      const times = readJson<Record<string, Record<string, number>>>(process.env.FAKE_HERMES_MESSAGE_TIMES_FILE, {});
      return { success: true, times: times[request.session_id ?? ""] ?? {} };
    }
    default:
      return { success: false, error: `unknown action ${request.action}` };
  }
}
