import { log } from "../log";
import type { ApnsClient } from "../push/apns-client";
import type { PushTokenRegistry } from "../push/push-tokens";
import type { RenderedCopy } from "./signal";

export type PlatformDelivery = {
  readonly deliveryId: string;
  readonly copy: RenderedCopy;
  readonly conversationId: string | undefined;
};

export class PlatformPush {
  constructor(
    private readonly tokens: PushTokenRegistry,
    private readonly apns: ApnsClient,
  ) {}

  async send(delivery: PlatformDelivery): Promise<boolean> {
    let accepted = false;
    for (const registration of this.tokens.list()) {
      const result = await this.apns.send({
        deviceToken: registration.token,
        topic: registration.bundleId,
        environment: registration.environment,
        collapseId: delivery.deliveryId.slice(0, 64),
        payload: {
          aps: {
            alert: { title: delivery.copy.title, body: delivery.copy.body },
            sound: "default",
            ...(delivery.conversationId ? { "thread-id": delivery.conversationId } : {}),
          },
          ...(delivery.conversationId ? { conversationId: delivery.conversationId, deep_link: { conversationId: delivery.conversationId } } : {}),
        },
      });
      switch (result.kind) {
        case "delivered":
          accepted = true;
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
    return accepted;
  }

  close(): void {
    this.apns.close();
  }
}
