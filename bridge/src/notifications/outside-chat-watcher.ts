import { join } from "node:path";
import { z } from "zod";
import { runHermesHelper, type HelperCommand } from "../hermes/helper-process";
import { log } from "../log";
import { privateJsonFile, type JsonFile } from "../storage/json-file";
import type { NotificationRouter } from "./notification-router";
import { FinishedReplySchema, OUTSIDE_CHAT_SOURCES, outsideChatSignal, type FinishedReply, type ScheduledJob } from "./outside-chat-producer";

const RepliesResultSchema = z.object({ success: z.literal(true), replies: z.array(FinishedReplySchema) });
const JobsResultSchema = z.object({
  success: z.literal(true),
  jobs: z.array(z.object({ id: z.string(), name: z.string().nullable(), deliver: z.string().nullable() })),
});
const WatermarkSchema = z.object({ since: z.number() });

export class OutsideChatWatcher {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;

  private constructor(
    private readonly helper: HelperCommand,
    private readonly router: NotificationRouter,
    private readonly watermark: JsonFile<z.infer<typeof WatermarkSchema>>,
    private since: number,
    private readonly pollMs: number,
  ) {}

  static async start(stateDir: string, helper: HelperCommand, router: NotificationRouter, pollMs: number): Promise<OutsideChatWatcher> {
    const watermark = privateJsonFile(join(stateDir, "outside-chats.json"), WatermarkSchema, { since: Date.now() / 1000 });
    const watcher = new OutsideChatWatcher(helper, router, watermark, (await watermark.read()).since, pollMs);
    await watermark.write({ since: watcher.since });
    watcher.schedule();
    return watcher;
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) {
      clearTimeout(this.timer);
    }
  }

  private schedule(): void {
    if (!this.stopped) {
      this.timer = setTimeout(() => void this.poll().finally(() => this.schedule()), this.pollMs);
    }
  }

  private async poll(): Promise<void> {
    try {
      const { replies } = await runHermesHelper(this.helper, "sessions", { action: "finished_replies", sources: OUTSIDE_CHAT_SOURCES, since: this.since }, RepliesResultSchema);
      if (replies.length === 0) {
        return;
      }
      const jobs = replies.some((reply) => reply.source === "cron") ? await this.scheduledJobs() : new Map<string, ScheduledJob>();
      for (const reply of replies.toSorted((left, right) => left.replied_at - right.replied_at)) {
        await this.notify(reply, jobs);
      }
      this.since = Math.max(this.since, ...replies.map((reply) => reply.replied_at));
      await this.watermark.write({ since: this.since });
    } catch (error) {
      log.warn("could not check Hermes for outside chats", { error: error instanceof Error ? error.message : String(error) });
    }
  }

  private async notify(reply: FinishedReply, jobs: ReadonlyMap<string, ScheduledJob>): Promise<void> {
    if (reply.source === "cron" && this.router.hasNotifiedSourceContextSince(reply.id, reply.started_at * 1000)) {
      return;
    }
    const signal = outsideChatSignal(reply, jobs);
    if (signal) {
      await this.router.emit(signal);
    }
  }

  private async scheduledJobs(): Promise<ReadonlyMap<string, ScheduledJob>> {
    const { jobs } = await runHermesHelper(this.helper, "cron", { action: "list" }, JobsResultSchema.passthrough());
    return new Map(jobs.map((job) => [job.id, { name: job.name ?? job.id, deliver: job.deliver }]));
  }
}
