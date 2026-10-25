import { existsSync, readFileSync } from "node:fs";

type Reply = { id: string; source: string; replied_at: number };

export type SessionsRequest = { action: string; sources?: string[]; since?: number };

export function handleSessions(request: SessionsRequest): object {
  const stateFile = process.env.FAKE_HERMES_SESSIONS_FILE ?? "";
  const replies: Reply[] = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, "utf8")) : [];
  if (request.action !== "finished_replies") {
    return { success: false, error: `unknown action ${request.action}` };
  }
  const sources = new Set(request.sources ?? []);
  return { success: true, replies: replies.filter((reply) => sources.has(reply.source) && reply.replied_at > (request.since ?? 0)) };
}
