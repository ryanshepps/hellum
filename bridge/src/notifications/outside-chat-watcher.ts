import { join } from "node:path";
import { z } from "zod";
import { runHermesHelper, type HelperCommand } from "../hermes/helper-process";
import { log } from "../log";
import { privateJsonFile, type JsonFile } from "../storage/json-file";
import type { NotificationRouter } from "./notification-router";
import { FinishedReplySchema, OUTSIDE_CHAT_SOURCES, outsideChatSignal } from "./outside-chat-producer";

const RepliesResultSchema = z.object({ success: z.literal(true), replies: z.array(FinishedReplySchema) });
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
      for (const reply of replies.toSorted((left, right) => left.replied_at - right.replied_at)) {
        const signal = outsideChatSignal(reply);
        if (signal) {
          await this.router.emit(signal);
        }
      }
      this.since = Math.max(this.since, ...replies.map((reply) => reply.replied_at));
      await this.watermark.write({ since: this.since });
    } catch (error) {
      log.warn("could not check Hermes for outside chats", { error: error instanceof Error ? error.message : String(error) });
    }
  }
}
