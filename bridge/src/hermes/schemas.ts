import { z } from "zod";
import type { ServerRequest } from "./wire";

export const JsonValueSchema = z.json();
export type JsonValue = z.infer<typeof JsonValueSchema>;

const TextOrBlank = z.string().nullish().transform((value) => value ?? "");

export const SessionRowSchema = z.object({
  id: z.string(),
  title: TextOrBlank,
  preview: TextOrBlank,
  started_at: z.number(),
  message_count: z.number(),
  source: TextOrBlank,
  runtime_revision: z.number().nullish().transform((value) => value ?? 0),
  runtime_generation: z.number().nullish().transform((value) => value ?? 0),
});
export type SessionRow = z.infer<typeof SessionRowSchema>;

export const SessionListResultSchema = z.object({ success: z.literal(true), sessions: z.array(SessionRowSchema) });

export const SessionOpenResultSchema = z.object({
  session_id: z.string(),
  stored_session_id: z.string().optional(),
  subscription_id: z.string(),
  revision: z.number(),
  execution_generation: z.number(),
});

const RowFields = { timestamp: z.number().nullish(), row_id: z.number().nullish() };

export const HistoryMessageSchema = z.discriminatedUnion("role", [
  z.object({ role: z.literal("user"), text: z.string(), ...RowFields }),
  z.object({ role: z.literal("system"), text: z.string() }),
  z.object({ role: z.literal("assistant"), text: z.string(), reasoning: z.string().nullish(), ...RowFields }),
  z.object({ role: z.literal("tool"), name: z.string(), context: z.string().nullish(), ...RowFields }),
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

const ControlFields = {
  prompt_id: z.string(),
  execution_generation: z.number(),
};

const ClarifyPayloadSchema = z.object({
  ...ControlFields,
  question: z.string(),
  choices: z.array(z.string()).nullish(),
});

const SecretParamsSchema = z.object({ session_id: z.string(), prompt: z.string(), env_var: z.string() });

const SudoParamsSchema = z.object({ session_id: z.string() });

export type PromptControl = { readonly promptId: string; readonly generation: number };

export type HermesPrompt =
  | { readonly kind: "clarify"; readonly requestId: string; readonly control: PromptControl; readonly question: string; readonly choices: readonly string[] }
  | { readonly kind: "secret"; readonly requestId: string; readonly prompt: string; readonly envVar: string }
  | { readonly kind: "sudo"; readonly requestId: string };

const ApprovalPayloadSchema = z.object({
  ...ControlFields,
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
  | { readonly type: "approval.request"; readonly control: PromptControl; readonly command: string; readonly description: string | null }
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
      return parsed.success
        ? {
            type,
            control: { promptId: parsed.data.prompt_id, generation: parsed.data.execution_generation },
            command: parsed.data.command,
            description: parsed.data.description ?? null,
          }
        : null;
    }
    case "clarify.request": {
      const parsed = ClarifyPayloadSchema.safeParse(payload);
      return parsed.success
        ? {
            type: "prompt.request",
            prompt: {
              kind: "clarify",
              requestId: parsed.data.prompt_id,
              control: { promptId: parsed.data.prompt_id, generation: parsed.data.execution_generation },
              question: parsed.data.question,
              choices: parsed.data.choices ?? [],
            },
          }
        : null;
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

export type ServerPrompt = { readonly sessionId: string; readonly prompt: HermesPrompt };

export function parseServerPrompt(request: ServerRequest): ServerPrompt | null {
  switch (request.method) {
    case "secret": {
      const parsed = SecretParamsSchema.safeParse(request.params);
      return parsed.success
        ? { sessionId: parsed.data.session_id, prompt: { kind: "secret", requestId: request.id, prompt: parsed.data.prompt, envVar: parsed.data.env_var } }
        : null;
    }
    case "sudo": {
      const parsed = SudoParamsSchema.safeParse(request.params);
      return parsed.success ? { sessionId: parsed.data.session_id, prompt: { kind: "sudo", requestId: request.id } } : null;
    }
    default:
      return null;
  }
}
