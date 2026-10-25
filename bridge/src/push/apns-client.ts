import http2 from "node:http2";

export type ApnsEnvironment = "development" | "production";

export const APNS_ORIGINS: Readonly<Record<ApnsEnvironment, string>> = {
  development: "https://api.sandbox.push.apple.com",
  production: "https://api.push.apple.com",
};

export type ApnsPayload = {
  readonly aps: {
    readonly alert: { readonly title: string; readonly body: string };
    readonly sound: "default";
    readonly "thread-id"?: string;
  };
  readonly conversationId?: string;
  readonly deep_link?: { readonly conversationId: string };
};

export type ApnsSend = {
  readonly deviceToken: string;
  readonly topic: string;
  readonly environment: ApnsEnvironment;
  readonly payload: ApnsPayload;
  readonly collapseId?: string;
};

export type ApnsResult =
  | { readonly kind: "delivered" }
  | { readonly kind: "token-invalid"; readonly reason: string }
  | { readonly kind: "failed"; readonly status: number; readonly reason: string };

const INVALID_TOKEN_REASONS: ReadonlySet<string> = new Set(["BadDeviceToken", "Unregistered", "DeviceTokenNotForTopic"]);
const REQUEST_TIMEOUT_MS = 15_000;

export function classifyApnsResponse(status: number, body: string): ApnsResult {
  if (status === 200) {
    return { kind: "delivered" };
  }
  let reason = "";
  try {
    const parsed: unknown = JSON.parse(body);
    reason = typeof parsed === "object" && parsed !== null && "reason" in parsed && typeof parsed.reason === "string" ? parsed.reason : "";
  } catch {
    reason = body.slice(0, 200);
  }
  return status === 410 || INVALID_TOKEN_REASONS.has(reason) ? { kind: "token-invalid", reason } : { kind: "failed", status, reason };
}

export type ApnsClient = {
  readonly send: (message: ApnsSend) => Promise<ApnsResult>;
  readonly close: () => void;
};

export function createApnsClient(
  providerToken: () => Promise<string>,
  origins: Readonly<Record<ApnsEnvironment, string>> = APNS_ORIGINS,
): ApnsClient {
  const sessions = new Map<string, http2.ClientHttp2Session>();

  function session(origin: string): http2.ClientHttp2Session {
    const existing = sessions.get(origin);
    if (existing && !existing.closed && !existing.destroyed) {
      return existing;
    }
    const created = http2.connect(origin);
    created.on("error", () => sessions.delete(origin));
    created.on("close", () => sessions.delete(origin));
    sessions.set(origin, created);
    return created;
  }

  async function send(message: ApnsSend): Promise<ApnsResult> {
    const token = await providerToken();
    return new Promise<ApnsResult>((resolve) => {
      const request = session(origins[message.environment]).request({
        ":method": "POST",
        ":path": `/3/device/${message.deviceToken}`,
        authorization: `bearer ${token}`,
        "apns-topic": message.topic,
        "apns-push-type": "alert",
        "apns-priority": "10",
        ...(message.collapseId ? { "apns-collapse-id": message.collapseId } : {}),
        "content-type": "application/json",
      });
      let status = 0;
      let body = "";
      request.setTimeout(REQUEST_TIMEOUT_MS, () => {
        request.close();
        resolve({ kind: "failed", status: 0, reason: "timeout" });
      });
      request.on("response", (headers) => {
        status = Number(headers[":status"] ?? 0);
      });
      request.on("data", (chunk: Buffer) => {
        body += chunk.toString("utf8");
      });
      request.on("end", () => resolve(classifyApnsResponse(status, body)));
      request.on("error", (error) => resolve({ kind: "failed", status: 0, reason: error.message }));
      request.end(JSON.stringify(message.payload));
    });
  }

  return {
    send,
    close: () => {
      for (const active of sessions.values()) {
        active.close();
      }
      sessions.clear();
    },
  };
}
