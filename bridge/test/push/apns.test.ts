import { afterEach, describe, expect, test } from "bun:test";
import { classifyApnsResponse, createApnsClient, type ApnsResult } from "../../src/push/apns-client";
import { createTokenCache, signApnsToken } from "../../src/push/apns-jwt";
import { generateApnsKeyPem, startFakeApns, type FakeApns } from "../support/fake-apns";

let apns: FakeApns | null = null;

afterEach(async () => {
  await apns?.close();
  apns = null;
});

function decodeSegment(segment: string | undefined): object {
  return JSON.parse(Buffer.from(segment ?? "", "base64url").toString("utf8"));
}

describe("signApnsToken", () => {
  test("produces an ES256 provider token Apple can verify with the key's public half", async () => {
    const { pem, publicKey } = await generateApnsKeyPem();
    const token = await signApnsToken({ keyId: "ABCDEFGHIJ", teamId: "TEAM123456", privateKeyPem: pem }, 1_800_000_000);
    const [header, claims, signature] = token.split(".");
    expect(decodeSegment(header)).toEqual({ alg: "ES256", kid: "ABCDEFGHIJ" });
    expect(decodeSegment(claims)).toEqual({ iss: "TEAM123456", iat: 1_800_000_000 });
    const verified = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      publicKey,
      Buffer.from(signature ?? "", "base64url"),
      new TextEncoder().encode(`${header}.${claims}`),
    );
    expect(verified).toBe(true);
  });

  test("reuses a token until it nears Apple's one-hour limit", async () => {
    const { pem } = await generateApnsKeyPem();
    let now = 1_800_000_000_000;
    const token = createTokenCache({ keyId: "ABCDEFGHIJ", teamId: "TEAM123456", privateKeyPem: pem }, () => now);
    const first = await token();
    now += 49 * 60 * 1000;
    expect(await token()).toBe(first);
    now += 2 * 60 * 1000;
    expect(await token()).not.toBe(first);
  });
});

describe("classifyApnsResponse", () => {
  const cases: ReadonlyArray<readonly [number, string, ApnsResult]> = [
    [200, "", { kind: "delivered" }],
    [410, '{"reason":"Unregistered"}', { kind: "token-invalid", reason: "Unregistered" }],
    [400, '{"reason":"BadDeviceToken"}', { kind: "token-invalid", reason: "BadDeviceToken" }],
    [400, '{"reason":"DeviceTokenNotForTopic"}', { kind: "token-invalid", reason: "DeviceTokenNotForTopic" }],
    [403, '{"reason":"InvalidProviderToken"}', { kind: "failed", status: 403, reason: "InvalidProviderToken" }],
    [500, "oops", { kind: "failed", status: 500, reason: "oops" }],
  ];
  for (const [status, body, expected] of cases) {
    test(`${status} ${body}`, () => {
      expect(classifyApnsResponse(status, body)).toEqual(expected);
    });
  }
});

describe("createApnsClient", () => {
  test("posts the payload to the device path with the provider token and topic", async () => {
    apns = await startFakeApns();
    const client = createApnsClient(async () => "provider-token", { development: apns.origin, production: apns.origin });
    const result = await client.send({
      deviceToken: "a1b2c3d4e5f60718293a4b5c6d7e8f90",
      topic: "com.example.hellum",
      environment: "production",
      collapseId: "conv:a0",
      payload: { aps: { alert: { title: "Hellum", body: "Done" }, sound: "default" }, conversationId: "conv" },
    });
    client.close();
    expect(result).toEqual({ kind: "delivered" });
    const [push] = apns.received;
    expect(push?.path).toBe("/3/device/a1b2c3d4e5f60718293a4b5c6d7e8f90");
    expect(push?.headers).toMatchObject({
      authorization: "bearer provider-token",
      "apns-topic": "com.example.hellum",
      "apns-push-type": "alert",
      "apns-collapse-id": "conv:a0",
    });
    expect(JSON.parse(push?.body ?? "{}")).toEqual({ aps: { alert: { title: "Hellum", body: "Done" }, sound: "default" }, conversationId: "conv" });
  });
});
