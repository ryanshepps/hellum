import { z } from "zod";

const ErrorSchema = z.object({ code: z.number(), message: z.string(), data: z.record(z.string(), z.unknown()).optional() });

const ErrorResponseSchema = z.object({ id: z.union([z.string(), z.number(), z.null()]), error: ErrorSchema });

const ResultResponseSchema = z.object({ id: z.union([z.string(), z.number()]), result: z.unknown() });

const ServerRequestSchema = z.object({
  id: z.string(),
  method: z.string(),
  params: z.record(z.string(), z.unknown()).optional(),
});

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

export type ServerRequest = {
  readonly id: string;
  readonly method: string;
  readonly params: Readonly<Record<string, unknown>>;
};

export type ErrorData = Readonly<Record<string, unknown>>;

export type Frame =
  | { readonly kind: "result"; readonly id: string; readonly result: unknown }
  | { readonly kind: "error"; readonly id: string | null; readonly code: number; readonly message: string; readonly data: ErrorData }
  | { readonly kind: "request"; readonly request: ServerRequest }
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
  const request = ServerRequestSchema.safeParse(raw);
  if (request.success) {
    return { kind: "request", request: { id: request.data.id, method: request.data.method, params: request.data.params ?? {} } };
  }
  const failure = ErrorResponseSchema.safeParse(raw);
  if (failure.success) {
    const { id, error } = failure.data;
    return { kind: "error", id: id === null ? null : String(id), code: error.code, message: error.message, data: error.data ?? {} };
  }
  const success = ResultResponseSchema.safeParse(raw);
  if (!success.success || !(typeof raw === "object" && raw !== null && "result" in raw)) {
    return { kind: "invalid", line };
  }
  return { kind: "result", id: String(success.data.id), result: success.data.result };
}

export type RpcParams = Readonly<
  Record<string, string | number | boolean | null | undefined | readonly string[] | Readonly<Record<string, string>>>
>;

export function encodeRequest(id: string, method: string, params: RpcParams): string {
  return `${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`;
}

export function encodeResponse(id: string, result: unknown): string {
  return `${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`;
}

export function splitLines(buffered: string, chunk: string): { readonly lines: readonly string[]; readonly rest: string } {
  const combined = buffered + chunk;
  const parts = combined.split("\n");
  const rest = parts.pop() ?? "";
  return { lines: parts.map((part) => part.trim()).filter((part) => part.length > 0), rest };
}
