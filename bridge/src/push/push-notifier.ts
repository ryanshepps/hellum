import type { EventHub } from "../events/event-hub";
import { log } from "../log";
import type { ApnsClient } from "./apns-client";
import { initialNotificationState, observeEvent, type Notification, type NotificationState } from "./notifications";
import type { PushTokenRegistry } from "./push-tokens";

export class PushNotifier {
  private state: NotificationState;
  private readonly unsubscribe: () => void;
  private deliveries: Promise<void> = Promise.resolve();

  constructor(
    hub: EventHub,
    private readonly tokens: PushTokenRegistry,
    private readonly apns: ApnsClient,
    fallbackTitle: string,
  ) {
    this.state = initialNotificationState(fallbackTitle);
    this.unsubscribe = hub.subscribe((envelope) => {
      const observed = observeEvent(this.state, envelope.message);
      this.state = observed.state;
      if (observed.notification) {
        const notification = observed.notification;
        this.deliveries = this.deliveries.then(() => this.deliver(notification));
      }
    });
  }

  settled(): Promise<void> {
    return this.deliveries;
  }

  stop(): void {
    this.unsubscribe();
    this.apns.close();
  }

  private async deliver(notification: Notification): Promise<void> {
    for (const registration of this.tokens.list()) {
      const result = await this.apns.send({
        deviceToken: registration.token,
        topic: registration.bundleId,
        environment: registration.environment,
        collapseId: notification.collapseId.slice(0, 64),
        payload: {
          aps: { alert: { title: notification.title, body: notification.body }, sound: "default", "thread-id": notification.conversationId },
          conversationId: notification.conversationId,
        },
      });
      switch (result.kind) {
        case "delivered":
          break;
        case "token-invalid":
          log.info("removing push token Apple rejected", { reason: result.reason });
          await this.tokens.remove(registration.token);
          break;
        case "failed":
          log.warn("push delivery failed", { status: result.status, reason: result.reason });
          break;
        default: {
          const exhaustive: never = result;
          return exhaustive;
        }
      }
    }
  }
}
