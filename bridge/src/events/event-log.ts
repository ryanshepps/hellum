import type { AssistantEvent, AssistantEventEnvelope } from "@vellumai/assistant-api";

export const EVENT_LOG_CAPACITY = 2000;

export type EventLog = {
  readonly lastSeq: number;
  readonly entries: readonly AssistantEventEnvelope[];
};

export function emptyEventLog(startSeq: number): EventLog {
  return { lastSeq: startSeq, entries: [] };
}

export type AppendInput = {
  readonly id: string;
  readonly emittedAt: string;
  readonly conversationId: string | undefined;
  readonly message: AssistantEvent;
};

export function appendEvent(log: EventLog, input: AppendInput): { readonly log: EventLog; readonly envelope: AssistantEventEnvelope } {
  const seq = log.lastSeq + 1;
  const envelope: AssistantEventEnvelope = {
    id: input.id,
    seq,
    emittedAt: input.emittedAt,
    message: input.message,
    ...(input.conversationId ? { conversationId: input.conversationId } : {}),
  };
  const entries = [...log.entries, envelope].slice(-EVENT_LOG_CAPACITY);
  return { log: { lastSeq: seq, entries }, envelope };
}

export function eventsAfter(log: EventLog, seq: number): readonly AssistantEventEnvelope[] {
  return log.entries.filter((envelope) => (envelope.seq ?? 0) > seq);
}
