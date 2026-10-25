import { join } from "node:path";
import { z } from "zod";
import { privateJsonFile } from "../storage/json-file";

const MAX_EVENTS = 1_000;

const EventSchema = z.object({
  dedupeKey: z.string(),
  sourceContextId: z.string().optional(),
  emittedAt: z.number(),
});

const LogSchema = z.object({ events: z.array(EventSchema) });

export type NotificationEventRecord = z.infer<typeof EventSchema>;

export class NotificationLog {
  private constructor(
    private events: readonly NotificationEventRecord[],
    private readonly save: (events: readonly NotificationEventRecord[]) => Promise<void>,
  ) {}

  static async open(stateDir: string): Promise<NotificationLog> {
    const file = privateJsonFile(join(stateDir, "notification-events.json"), LogSchema, { events: [] });
    const { events } = await file.read();
    return new NotificationLog(events, (next) => file.write({ events: [...next] }));
  }

  has(dedupeKey: string): boolean {
    return this.events.some((event) => event.dedupeKey === dedupeKey);
  }

  hasNotifiedSourceContextSince(sourceContextId: string, sinceMs: number): boolean {
    return this.events.some((event) => event.sourceContextId === sourceContextId && event.emittedAt >= sinceMs);
  }

  record(event: NotificationEventRecord): Promise<void> {
    this.events = [...this.events, event].slice(-MAX_EVENTS);
    return this.save(this.events);
  }
}
