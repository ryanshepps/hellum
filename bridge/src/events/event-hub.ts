import type { AssistantEvent, AssistantEventEnvelope } from "@vellumai/assistant-api";
import { randomUUID } from "node:crypto";
import { appendEvent, emptyEventLog, eventsAfter, type EventLog } from "./event-log";

const HEARTBEAT_INTERVAL_MS = 7_000;

type Subscriber = (envelope: AssistantEventEnvelope) => void;

function encodeEnvelope(envelope: AssistantEventEnvelope): string {
  return `id: ${envelope.seq ?? ""}\ndata: ${JSON.stringify(envelope)}\n\n`;
}

export class EventHub {
  private log: EventLog;
  private readonly subscribers = new Set<Subscriber>();

  constructor(startSeq: number = Date.now()) {
    this.log = emptyEventLog(startSeq);
  }

  get lastSeq(): number {
    return this.log.lastSeq;
  }

  publish(event: AssistantEvent): AssistantEventEnvelope {
    const conversationId = "conversationId" in event ? event.conversationId : undefined;
    const appended = appendEvent(this.log, {
      id: randomUUID(),
      emittedAt: new Date().toISOString(),
      conversationId,
      message: event,
    });
    this.log = appended.log;
    for (const subscriber of this.subscribers) {
      subscriber(appended.envelope);
    }
    return appended.envelope;
  }

  subscribe(subscriber: Subscriber): () => void {
    this.subscribers.add(subscriber);
    return () => this.subscribers.delete(subscriber);
  }

  stream(lastSeenSeq: number | null, signal: AbortSignal): Response {
    const encoder = new TextEncoder();
    let unsubscribe: () => void = () => undefined;
    let heartbeat: ReturnType<typeof setInterval> | null = null;
    const cleanup = (): void => {
      unsubscribe();
      if (heartbeat) {
        clearInterval(heartbeat);
      }
    };

    const body = new ReadableStream<Uint8Array>({
      start: (controller) => {
        const send = (text: string): void => {
          try {
            controller.enqueue(encoder.encode(text));
          } catch {
            cleanup();
          }
        };
        send(": connected\n\n");
        if (lastSeenSeq !== null) {
          for (const envelope of eventsAfter(this.log, lastSeenSeq)) {
            send(encodeEnvelope(envelope));
          }
        }
        unsubscribe = this.subscribe((envelope) => send(encodeEnvelope(envelope)));
        heartbeat = setInterval(() => send(": heartbeat\n\n"), HEARTBEAT_INTERVAL_MS);
        signal.addEventListener("abort", () => {
          cleanup();
          try {
            controller.close();
          } catch {
            cleanup();
          }
        });
      },
      cancel: cleanup,
    });

    return new Response(body, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-store",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  }
}
