import { z } from "zod";
import { resolveTitle } from "./copy-composer";

export const UrgencySchema = z.enum(["low", "medium", "high", "critical"]);
export type Urgency = z.infer<typeof UrgencySchema>;

export type NotificationChannel = "vellum" | "platform";

export type NotificationSignal = {
  readonly sourceEventName: string;
  readonly sourceChannel: string;
  readonly sourceContextId?: string | undefined;
  readonly urgency: Urgency;
  readonly requestedTitle?: string | undefined;
  readonly requestedMessage: string;
  readonly dedupeKey?: string | undefined;
  readonly quiet?: boolean | undefined;
};

export type RenderedCopy = {
  readonly title: string;
  readonly body: string;
};

export function isCompletionNotification(signal: Pick<NotificationSignal, "sourceEventName">): boolean {
  return signal.sourceEventName === "chat.assistant_reply" || signal.sourceEventName === "schedule.result";
}

function isUrgent(urgency: Urgency): boolean {
  return urgency === "high" || urgency === "critical";
}

export function selectChannels(signal: NotificationSignal, available: readonly NotificationChannel[]): readonly NotificationChannel[] {
  if (isCompletionNotification(signal) || isUrgent(signal.urgency)) {
    return available;
  }
  return available.filter((channel) => channel === "vellum");
}

export function isLocalNotificationSilent(signal: NotificationSignal): boolean {
  if (signal.quiet === true) {
    return true;
  }
  return !isCompletionNotification(signal) && !isUrgent(signal.urgency);
}

export function renderCopy(signal: NotificationSignal): RenderedCopy {
  const body = signal.requestedMessage.trim();
  return { title: resolveTitle(signal.requestedTitle, body), body };
}
