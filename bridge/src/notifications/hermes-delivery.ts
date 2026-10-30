import { z } from "zod";
import { notificationTitle, replyPreview } from "./reply-producer";
import type { NotificationSignal } from "./signal";

export const HermesDeliverySchema = z.object({
  message: z.string(),
  jobId: z.string().min(1).optional(),
  jobName: z.string().optional(),
  sessionId: z.string().min(1).optional(),
});
export type HermesDelivery = z.infer<typeof HermesDeliverySchema>;

const FALLBACK_SCHEDULE_NAME = "Scheduled task";

export function deliverySignal(delivery: HermesDelivery): NotificationSignal | null {
  const body = replyPreview(delivery.message);
  if (!body) {
    return null;
  }
  if (delivery.jobId) {
    return {
      sourceEventName: "schedule.result",
      sourceChannel: "scheduler",
      sourceContextId: delivery.sessionId,
      urgency: "medium",
      requestedTitle: notificationTitle(delivery.jobName ?? FALLBACK_SCHEDULE_NAME),
      requestedMessage: body,
      dedupeKey: delivery.sessionId ? `schedule.result:${delivery.jobId}:${delivery.sessionId}` : undefined,
    };
  }
  return {
    sourceEventName: "assistant.message",
    sourceChannel: "hermes",
    sourceContextId: delivery.sessionId,
    urgency: "high",
    requestedMessage: body,
  };
}
