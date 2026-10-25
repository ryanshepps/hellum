import { randomUUID } from "node:crypto";
import type { EventHub } from "../events/event-hub";
import { log } from "../log";
import type { NotificationLog } from "./notification-log";
import type { PlatformPush } from "./platform-push";
import { isLocalNotificationSilent, renderCopy, selectChannels, type NotificationChannel, type NotificationSignal } from "./signal";

export type EmitResult = {
  readonly deduplicated: boolean;
  readonly channels: readonly NotificationChannel[];
  readonly remotePushAccepted: boolean;
};

export class NotificationRouter {
  private deliveries: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly hub: EventHub,
    private readonly events: NotificationLog,
    private readonly platform: PlatformPush | null,
    private readonly assistantName: string,
  ) {}

  emit(signal: NotificationSignal): Promise<EmitResult> {
    const next = this.deliveries.then(() => this.deliver(signal));
    this.deliveries = next.catch(() => undefined);
    return next;
  }

  settled(): Promise<unknown> {
    return this.deliveries;
  }

  hasNotifiedSourceContextSince(sourceContextId: string, sinceMs: number): boolean {
    return this.events.hasNotifiedSourceContextSince(sourceContextId, sinceMs);
  }

  stop(): void {
    this.platform?.close();
  }

  private availableChannels(): readonly NotificationChannel[] {
    return this.platform ? ["vellum", "platform"] : ["vellum"];
  }

  private async deliver(signal: NotificationSignal): Promise<EmitResult> {
    const deliveryId = randomUUID();
    const dedupeKey = signal.dedupeKey ?? deliveryId;
    if (this.events.has(dedupeKey)) {
      return { deduplicated: true, channels: [], remotePushAccepted: false };
    }
    await this.events.record({
      dedupeKey,
      emittedAt: Date.now(),
      ...(signal.sourceContextId ? { sourceContextId: signal.sourceContextId } : {}),
    });
    const channels = selectChannels(signal, this.availableChannels());
    const copy = renderCopy(signal);
    let remotePushAccepted = false;
    if (this.platform && channels.includes("platform") && signal.quiet !== true) {
      try {
        remotePushAccepted = await this.platform.send({ deliveryId, copy, conversationId: signal.sourceContextId });
      } catch (error) {
        log.warn("push dispatch failed", { sourceEventName: signal.sourceEventName, error: error instanceof Error ? error.message : String(error) });
      }
    }
    if (channels.includes("vellum")) {
      this.hub.publish({
        type: "notification_intent",
        sourceEventName: signal.sourceEventName,
        assistantName: this.assistantName,
        title: copy.title,
        body: copy.body,
        deliveryId,
        ...(signal.sourceContextId ? { deepLinkMetadata: { conversationId: signal.sourceContextId } } : {}),
        silent: isLocalNotificationSilent(signal),
        remotePushDispatched: remotePushAccepted,
        ...(remotePushAccepted ? { remotePushPlatforms: ["ios" as const] } : {}),
      });
    }
    return { deduplicated: false, channels, remotePushAccepted };
  }
}
