import { z } from "zod";

const ErrorSchema = z.object({ code: z.number(), message: z.string() });

const ErrorResponseSchema = z.object({ id: z.union([z.string(), z.number(), z.null()]), error: ErrorSchema });

const ResultResponseSchema = z.object({ id: z.union([z.string(), z.number()]), result: z.unknown() });

const EventSchema = z.object({
  method: z.literal("event"),
  params: z.object({
    type: z.string(),
    session_id: z.string().optional(),
    payload: z.unknown().optional(),
  }),
});

export type HermesEvent = {
  readonly type: string;
  readonly sessionId: string | null;
  readonly payload: unknown;
};

export type Frame =
  | { readonly kind: "result"; readonly id: string; readonly result: unknown }
  | { readonly kind: "error"; readonly id: string | null; readonly code: number; readonly message: string }
  | { readonly kind: "event"; readonly event: HermesEvent }
  | { readonly kind: "invalid"; readonly line: string };

export function parseFrame(line: string): Frame {
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch {
    return { kind: "invalid", line };
  }
  const event = EventSchema.safeParse(raw);
  if (event.success) {
    const { type, session_id: sessionId, payload } = event.data.params;
    return { kind: "event", event: { type, sessionId: sessionId ?? null, payload } };
  }
  const failure = ErrorResponseSchema.safeParse(raw);
  if (failure.success) {
    const { id, error } = failure.data;
    return { kind: "error", id: id === null ? null : String(id), code: error.code, message: error.message };
  }
  const success = ResultResponseSchema.safeParse(raw);
  if (!success.success || !(typeof raw === "object" && raw !== null && "result" in raw)) {
    return { kind: "invalid", line };
  }
  return { kind: "result", id: String(success.data.id), result: success.data.result };
}

export type RpcParams = Readonly<Record<string, string | number | boolean | null | undefined | readonly string[]>>;

export function encodeRequest(id: string, method: string, params: RpcParams): string {
  return `${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`;
}

export function splitLines(buffered: string, chunk: string): { readonly lines: readonly string[]; readonly rest: string } {
  const combined = buffered + chunk;
  const parts = combined.split("\n");
  const rest = parts.pop() ?? "";
  return { lines: parts.map((part) => part.trim()).filter((part) => part.length > 0), rest };
}
