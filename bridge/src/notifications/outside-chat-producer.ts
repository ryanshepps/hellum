import { z } from "zod";
import { notificationTitle, replyPreview } from "./reply-producer";
import type { NotificationSignal } from "./signal";

export const OUTSIDE_CHAT_SOURCES = ["webhook", "cron"] as const;

export const FinishedReplySchema = z.object({
  id: z.string(),
  source: z.string(),
  title: z.string(),
  started_at: z.number(),
  message_id: z.string(),
  replied_at: z.number(),
  text: z.string(),
  silent: z.boolean(),
});
export type FinishedReply = z.infer<typeof FinishedReplySchema>;

export type ScheduledJob = {
  readonly name: string;
  readonly deliver: string | null;
};

const CRON_SESSION_ID = /^cron_(.+)_\d{8}_\d{6}$/;
const LOCAL_DELIVERY = "local";
const FALLBACK_SCHEDULE_NAME = "Scheduled task";

export function cronJobId(sessionId: string): string | null {
  return CRON_SESSION_ID.exec(sessionId)?.[1] ?? null;
}

function scheduleResultSignal(reply: FinishedReply, jobs: ReadonlyMap<string, ScheduledJob>): NotificationSignal | null {
  const jobId = cronJobId(reply.id);
  const job = jobId ? jobs.get(jobId) : undefined;
  if (reply.silent || !jobId || (job?.deliver && job.deliver !== LOCAL_DELIVERY)) {
    return null;
  }
  const body = replyPreview(reply.text);
  if (!body) {
    return null;
  }
  return {
    sourceEventName: "schedule.result",
    sourceChannel: "scheduler",
    sourceContextId: reply.id,
    urgency: "medium",
    requestedTitle: notificationTitle(job?.name ?? FALLBACK_SCHEDULE_NAME),
    requestedMessage: body,
    dedupeKey: `schedule.result:${jobId}:${reply.id}`,
  };
}

function webhookReplySignal(reply: FinishedReply): NotificationSignal | null {
  const body = replyPreview(reply.text);
  if (!body) {
    return null;
  }
  return {
    sourceEventName: "chat.assistant_reply",
    sourceChannel: "webhook",
    sourceContextId: reply.id,
    urgency: "medium",
    requestedTitle: notificationTitle(reply.title),
    requestedMessage: body,
    dedupeKey: `chat.assistant_reply:${reply.id}:${reply.message_id}`,
  };
}

export function outsideChatSignal(reply: FinishedReply, jobs: ReadonlyMap<string, ScheduledJob>): NotificationSignal | null {
  switch (reply.source) {
    case "cron":
      return scheduleResultSignal(reply, jobs);
    case "webhook":
      return webhookReplySignal(reply);
    default:
      return null;
  }
}
