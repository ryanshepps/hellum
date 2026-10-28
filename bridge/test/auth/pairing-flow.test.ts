import { afterEach, describe, expect, test } from "bun:test";
import { stat } from "node:fs/promises";
import { postJson, startTestBridge, type TestBridge } from "../support/test-bridge";

const API_PATH = "/v1/assistants/hellum/conversations";

let bridge: TestBridge | null = null;

afterEach(async () => {
  await bridge?.dispose();
  bridge = null;
});

type ApprovedSession = { readonly accessToken: string; readonly refreshCookie: string };

function refreshCookieFrom(response: Response): string {
  const header = response.headers.get("Set-Cookie") ?? "";
  const cookie = header.split(";")[0] ?? "";
  if (!cookie.startsWith("hellum_refresh=")) throw new Error(`missing refresh cookie in ${header}`);
  return cookie;
}

async function pairWithApprovedCode(target: TestBridge): Promise<ApprovedSession> {
  const created = (await (await target.admin("POST", "/pairings")).json()) as { deviceCode: string };
  const response = await target.request("/v1/remote-web/pairing-token", postJson({ deviceCode: created.deviceCode, platform: "ios", clientReportedName: "Test iPhone" }));
  expect(response.status).toBe(200);
  const body = (await response.json()) as { accessToken: string };
  return { accessToken: body.accessToken, refreshCookie: refreshCookieFrom(response) };
}

function withBearer(token: string): RequestInit {
  return { headers: { Authorization: `Bearer ${token}` } };
}

describe("device-first pairing", () => {
  test("a challenge stays pending until the host approves its user code", async () => {
    bridge = await startTestBridge();
    const challengeResponse = await bridge.request("/v1/remote-web/pairing-challenge", postJson({ publicBaseUrl: "https://mac.example.ts.net" }));
    expect(challengeResponse.status).toBe(200);
    const challenge = (await challengeResponse.json()) as {
      deviceCode: string;
      userCode: string;
      verificationUri: string;
      expiresInSeconds: number;
      intervalSeconds: number;
    };
    expect(challenge.userCode).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(challenge.verificationUri).toBe("https://mac.example.ts.net/assistant/pair");
    expect(challenge.expiresInSeconds).toBe(600);

    const pending = await bridge.request("/v1/remote-web/pairing-token", postJson({ deviceCode: challenge.deviceCode }));
    expect(pending.status).toBe(202);
    expect(((await pending.json()) as { status: string }).status).toBe("pending");

    const listed = (await (await bridge.admin("GET", "/pairings")).json()) as { pending: { userCode: string }[] };
    expect(listed.pending.map((request) => request.userCode)).toEqual([challenge.userCode]);

    const approval = await bridge.admin("POST", "/pairings/approve", { userCode: challenge.userCode.toLowerCase().replace("-", "") });
    expect(approval.status).toBe(200);

    const approved = await bridge.request("/v1/remote-web/pairing-token", postJson({ deviceCode: challenge.deviceCode }));
    expect(approved.status).toBe(200);
    const session = (await approved.json()) as { status: string; accessToken: string; assistantId: string };
    expect(session.status).toBe("approved");
    expect(session.assistantId).toBe("hellum");
    expect((await bridge.request(API_PATH, withBearer(session.accessToken))).status).not.toBe(401);
  });

  test("an unknown device code is reported as expired", async () => {
    bridge = await startTestBridge();
    const response = await bridge.request("/v1/remote-web/pairing-token", postJson({ deviceCode: "made-up" }));
    expect(response.status).toBe(401);
  });

  test("a device code can only be exchanged once", async () => {
    bridge = await startTestBridge();
    const created = (await (await bridge.admin("POST", "/pairings")).json()) as { deviceCode: string };
    expect((await bridge.request("/v1/remote-web/pairing-token", postJson({ deviceCode: created.deviceCode }))).status).toBe(200);
    expect((await bridge.request("/v1/remote-web/pairing-token", postJson({ deviceCode: created.deviceCode }))).status).toBe(401);
  });
});

describe("sessions", () => {
  test("assistant API requests without a valid access token are refused", async () => {
    bridge = await startTestBridge();
    expect((await bridge.request(API_PATH)).status).toBe(401);
    expect((await bridge.request(API_PATH, withBearer("forged"))).status).toBe(401);
  });

  test("the refresh cookie is HttpOnly, scoped to refresh, and Secure behind https", async () => {
    bridge = await startTestBridge();
    const created = (await (await bridge.admin("POST", "/pairings")).json()) as { deviceCode: string };
    const response = await bridge.request(
      "/v1/remote-web/pairing-token",
      postJson({ deviceCode: created.deviceCode }, { "X-Forwarded-Proto": "https" }),
    );
    const header = response.headers.get("Set-Cookie") ?? "";
    expect(header).toContain("HttpOnly");
    expect(header).toContain("Path=/v1/guardian");
    expect(header).toContain("SameSite=Strict");
    expect(header).toContain("Secure");
  });

  test("access tokens last 30 days and ask for a refresh after 24", async () => {
    bridge = await startTestBridge();
    const created = (await (await bridge.admin("POST", "/pairings")).json()) as { deviceCode: string };
    const before = Date.now();
    const response = await bridge.request("/v1/remote-web/pairing-token", postJson({ deviceCode: created.deviceCode }));
    const body = (await response.json()) as { accessTokenExpiresAt: string; refreshAfter: string };
    const day = 24 * 60 * 60 * 1000;
    expect(Date.parse(body.accessTokenExpiresAt) - before).toBeGreaterThanOrEqual(30 * day);
    expect(Math.round((Date.parse(body.refreshAfter) - before) / day)).toBe(24);
  });

  test("refresh rotates the cookie and rejects the spent one", async () => {
    bridge = await startTestBridge();
    const session = await pairWithApprovedCode(bridge);

    const refreshed = await bridge.request("/v1/guardian/refresh", postJson({}, { Cookie: session.refreshCookie }));
    expect(refreshed.status).toBe(200);
    const body = (await refreshed.json()) as { accessToken: string };
    expect((await bridge.request(API_PATH, withBearer(body.accessToken))).status).not.toBe(401);
    expect((await bridge.request(API_PATH, withBearer(session.accessToken))).status).toBe(401);

    const replayed = await bridge.request("/v1/guardian/refresh", postJson({}, { Cookie: session.refreshCookie }));
    expect(replayed.status).toBe(401);
    expect((await bridge.request("/v1/guardian/refresh", postJson({}, { Cookie: refreshCookieFrom(refreshed) }))).status).toBe(200);
  });

  test("paired devices and their access tokens survive a bridge restart", async () => {
    bridge = await startTestBridge();
    const session = await pairWithApprovedCode(bridge);
    const { stateDir } = bridge;
    await bridge.stop();

    bridge = await startTestBridge({ HELLUM_STATE_DIR: stateDir });
    expect((await bridge.request(API_PATH, withBearer(session.accessToken))).status).not.toBe(401);
    expect((await bridge.request("/v1/guardian/refresh", postJson({}, { Cookie: session.refreshCookie }))).status).toBe(200);
  });

  test("revoking a device ends its access and refresh", async () => {
    bridge = await startTestBridge();
    const session = await pairWithApprovedCode(bridge);
    const devices = (await (await bridge.admin("GET", "/devices")).json()) as { devices: { deviceId: string; platform: string; name: string }[] };
    expect(devices.devices).toEqual([expect.objectContaining({ platform: "ios", name: "Test iPhone" })]);

    const deviceId = devices.devices[0]?.deviceId ?? "";
    expect((await bridge.admin("DELETE", `/devices/${deviceId}`)).status).toBe(200);
    expect((await bridge.request(API_PATH, withBearer(session.accessToken))).status).toBe(401);
    expect((await bridge.request("/v1/guardian/refresh", postJson({}, { Cookie: session.refreshCookie }))).status).toBe(401);
  });
});

describe("host files", () => {
  test("the admin socket, device registry and access tokens are private to the owner", async () => {
    bridge = await startTestBridge();
    await pairWithApprovedCode(bridge);
    expect((await stat(bridge.adminSocketPath)).mode & 0o777).toBe(0o600);
    expect((await stat(`${bridge.stateDir}/devices.json`)).mode & 0o777).toBe(0o600);
    expect((await stat(`${bridge.stateDir}/access-tokens.json`)).mode & 0o777).toBe(0o600);
  });
});
