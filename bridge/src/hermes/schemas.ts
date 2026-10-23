import { z } from "zod";

export const JsonValueSchema = z.json();
export type JsonValue = z.infer<typeof JsonValueSchema>;

export const SessionRowSchema = z.object({
  id: z.string(),
  title: z.string(),
  preview: z.string(),
  started_at: z.number(),
  message_count: z.number(),
  source: z.string(),
});
export type SessionRow = z.infer<typeof SessionRowSchema>;

export const SessionListResultSchema = z.object({ sessions: z.array(SessionRowSchema) });

export const SessionOpenResultSchema = z.object({
  session_id: z.string(),
  stored_session_id: z.string().optional(),
  message_count: z.number().optional(),
});

export const HistoryMessageSchema = z.discriminatedUnion("role", [
  z.object({ role: z.literal("user"), text: z.string() }),
  z.object({ role: z.literal("system"), text: z.string() }),
  z.object({ role: z.literal("assistant"), text: z.string(), reasoning: z.string().nullish() }),
  z.object({ role: z.literal("tool"), name: z.string(), context: z.string().nullish() }),
]);
export type HistoryMessage = z.infer<typeof HistoryMessageSchema>;

export const HistoryResultSchema = z.object({ count: z.number(), messages: z.array(HistoryMessageSchema) });

export const SubmitResultSchema = z.object({ status: z.string() });

const TextPayloadSchema = z.object({ text: z.string() });

const ToolStartPayloadSchema = z.object({
  tool_id: z.string(),
  name: z.string(),
  context: z.string().nullish(),
});

const ToolCompletePayloadSchema = z.object({
  tool_id: z.string(),
  name: z.string(),
  args: z.record(z.string(), JsonValueSchema).nullish(),
  result: JsonValueSchema.optional(),
});

const ClarifyPayloadSchema = z.object({
  request_id: z.string(),
  question: z.string(),
  choices: z.array(z.string()).nullish(),
});

const SecretPayloadSchema = z.object({
  request_id: z.string(),
  prompt: z.string(),
  env_var: z.string(),
});

const SudoPayloadSchema = z.object({ request_id: z.string() });

export type HermesPrompt =
  | { readonly kind: "clarify"; readonly requestId: string; readonly question: string; readonly choices: readonly string[] }
  | { readonly kind: "secret"; readonly requestId: string; readonly prompt: string; readonly envVar: string }
  | { readonly kind: "sudo"; readonly requestId: string };

const ApprovalPayloadSchema = z.object({
  command: z.string(),
  description: z.string().nullish(),
});

const CompletePayloadSchema = z.object({
  text: z.string(),
  status: z.string().optional(),
});

const ErrorPayloadSchema = z.object({ message: z.string() });

export type ToolResultPayload = JsonValue | undefined;

export type HermesTurnEvent =
  | { readonly type: "message.start" }
  | { readonly type: "message.delta"; readonly text: string }
  | { readonly type: "reasoning.delta"; readonly text: string }
  | { readonly type: "tool.start"; readonly toolId: string; readonly name: string; readonly context: string | null }
  | {
      readonly type: "tool.complete";
      readonly toolId: string;
      readonly name: string;
      readonly args: Readonly<Record<string, JsonValue>>;
      readonly result: ToolResultPayload;
    }
  | { readonly type: "approval.request"; readonly command: string; readonly description: string | null }
  | { readonly type: "prompt.request"; readonly prompt: HermesPrompt }
  | { readonly type: "message.complete"; readonly text: string; readonly status: "complete" | "interrupted" }
  | { readonly type: "error"; readonly message: string };

export function parseTurnEvent(type: string, payload: unknown): HermesTurnEvent | null {
  switch (type) {
    case "message.start":
      return { type };
    case "message.delta":
    case "reasoning.delta": {
      const parsed = TextPayloadSchema.safeParse(payload);
      return parsed.success && parsed.data.text.length > 0 ? { type, text: parsed.data.text } : null;
    }
    case "tool.start": {
      const parsed = ToolStartPayloadSchema.safeParse(payload);
      return parsed.success
        ? { type, toolId: parsed.data.tool_id, name: parsed.data.name, context: parsed.data.context ?? null }
        : null;
    }
    case "tool.complete": {
      const parsed = ToolCompletePayloadSchema.safeParse(payload);
      return parsed.success
        ? {
            type,
            toolId: parsed.data.tool_id,
            name: parsed.data.name,
            args: parsed.data.args ?? {},
            result: parsed.data.result,
          }
        : null;
    }
    case "approval.request": {
      const parsed = ApprovalPayloadSchema.safeParse(payload);
      return parsed.success ? { type, command: parsed.data.command, description: parsed.data.description ?? null } : null;
    }
    case "clarify.request": {
      const parsed = ClarifyPayloadSchema.safeParse(payload);
      return parsed.success
        ? { type: "prompt.request", prompt: { kind: "clarify", requestId: parsed.data.request_id, question: parsed.data.question, choices: parsed.data.choices ?? [] } }
        : null;
    }
    case "secret.request": {
      const parsed = SecretPayloadSchema.safeParse(payload);
      return parsed.success
        ? { type: "prompt.request", prompt: { kind: "secret", requestId: parsed.data.request_id, prompt: parsed.data.prompt, envVar: parsed.data.env_var } }
        : null;
    }
    case "sudo.request": {
      const parsed = SudoPayloadSchema.safeParse(payload);
      return parsed.success ? { type: "prompt.request", prompt: { kind: "sudo", requestId: parsed.data.request_id } } : null;
    }
    case "message.complete": {
      const parsed = CompletePayloadSchema.safeParse(payload);
      return parsed.success
        ? { type, text: parsed.data.text, status: parsed.data.status === "interrupted" ? "interrupted" : "complete" }
        : null;
    }
    case "error": {
      const parsed = ErrorPayloadSchema.safeParse(payload);
      return parsed.success ? { type, message: parsed.data.message } : null;
    }
    default:
      return null;
  }
}
