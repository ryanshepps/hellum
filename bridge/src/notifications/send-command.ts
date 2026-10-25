import { parseArgs } from "node:util";
import { UrgencySchema, type Urgency } from "./signal";

export const DEFAULT_SOURCE_CHANNEL = "assistant_tool";
export const DEFAULT_SOURCE_EVENT_NAME = "assistant.share";

export type SendRequest = {
  readonly message: string;
  readonly title?: string;
  readonly urgency: Urgency;
  readonly sourceChannel: string;
  readonly sourceEventName: string;
  readonly sourceContextId?: string;
  readonly dedupeKey?: string;
};

export type ParsedSend = { readonly request: SendRequest; readonly json: boolean };

export class SendUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SendUsageError";
  }
}

export function parseSendArgs(args: readonly string[], env: Readonly<Record<string, string | undefined>>): ParsedSend {
  const { values } = parseArgs({
    args: [...args],
    options: {
      message: { type: "string" },
      title: { type: "string" },
      urgent: { type: "boolean", default: false },
      urgency: { type: "string" },
      "source-channel": { type: "string" },
      "source-event-name": { type: "string" },
      "conversation-id": { type: "string" },
      "session-id": { type: "string" },
      "dedupe-key": { type: "string" },
      json: { type: "boolean", default: false },
    },
    strict: true,
    allowPositionals: false,
  });
  const message = values.message?.trim();
  if (!message) {
    throw new SendUsageError("--message is required");
  }
  const urgency = UrgencySchema.safeParse(values.urgency ?? (values.urgent ? "critical" : "low"));
  if (!urgency.success) {
    throw new SendUsageError(`Invalid urgency "${values.urgency}". Must be one of: ${UrgencySchema.options.join(", ")}`);
  }
  const conversationId = values["conversation-id"]?.trim();
  if (values["conversation-id"] !== undefined && !conversationId) {
    throw new SendUsageError("Conversation ID must be a non-empty string");
  }
  const sourceContextId = values["session-id"] ?? env.HERMES_SESSION_ID ?? conversationId;
  return {
    json: values.json,
    request: {
      message,
      urgency: urgency.data,
      sourceChannel: values["source-channel"] ?? DEFAULT_SOURCE_CHANNEL,
      sourceEventName: values["source-event-name"] ?? DEFAULT_SOURCE_EVENT_NAME,
      ...(values.title ? { title: values.title } : {}),
      ...(sourceContextId ? { sourceContextId } : {}),
      ...(values["dedupe-key"] ? { dedupeKey: values["dedupe-key"] } : {}),
    },
  };
}
