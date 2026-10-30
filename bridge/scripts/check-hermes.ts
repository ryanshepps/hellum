import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { z } from "zod";
import { loadConfig } from "../src/config";
import { runHermesHelper } from "../src/hermes/helper-process";
import { startBridge } from "../src/server";

const READY_TIMEOUT_MS = 60_000;
const BUILT_WEB = resolve(import.meta.dir, "../../clients/web/dist");
const FIXTURE_WEB = resolve(import.meta.dir, "../test/fixtures/web");

type Check = { readonly name: string; readonly path: (latestConversation: string) => string };

const CHECKS: readonly Check[] = [
  { name: "transcript", path: (conversationId) => `messages?conversationId=${encodeURIComponent(conversationId)}` },
  { name: "skills", path: () => "skills" },
  { name: "schedules", path: () => "schedules" },
  { name: "model settings", path: () => "config" },
];

const DeliveryTargetsSchema = z.object({
  success: z.literal(true),
  targets: z.array(z.object({ id: z.string(), home_target_set: z.boolean() })),
});

const stateDir = await mkdtemp(join(tmpdir(), "hellum-check-"));
const config = loadConfig({
  ...process.env,
  HELLUM_PORT: "0",
  HELLUM_STATE_DIR: stateDir,
  HELLUM_WEB_DIST: existsSync(BUILT_WEB) ? BUILT_WEB : FIXTURE_WEB,
  HELLUM_HERMES_GATEWAY_ARGV: undefined,
  HELLUM_APNS_KEY_PATH: undefined,
  HELLUM_APNS_KEY_ID: undefined,
  HELLUM_APNS_TEAM_ID: undefined,
});
const bridge = await startBridge(config);

function report(name: string, ok: boolean, detail: string): boolean {
  process.stdout.write(`${ok ? "ok  " : "FAIL"} ${name}: ${detail}\n`);
  return ok;
}

async function pair(): Promise<Record<string, string>> {
  const created = (await (await fetch("http://hellum/pairings", { method: "POST", unix: bridge.adminSocketPath })).json()) as { deviceCode: string };
  const exchanged = await fetch(new URL("/v1/remote-web/pairing-token", bridge.url), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ deviceCode: created.deviceCode }),
  });
  const { accessToken } = (await exchanged.json()) as { accessToken: string };
  return { Authorization: `Bearer ${accessToken}` };
}

async function get(headers: Record<string, string>, path: string): Promise<Response> {
  return fetch(new URL(`/v1/assistants/self/${path}`, bridge.url), { headers });
}

async function untilAttached(headers: Record<string, string>, conversationId: string): Promise<Response> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  for (;;) {
    const response = await get(headers, `messages?conversationId=${encodeURIComponent(conversationId)}`);
    if (response.status !== 503 || Date.now() > deadline) {
      return response;
    }
    await Bun.sleep(1000);
  }
}

async function run(): Promise<boolean> {
  const headers = await pair();
  const listed = await get(headers, "conversations?limit=1&offset=0");
  const conversations = listed.ok ? ((await listed.json()) as { conversations: { id: string }[] }).conversations : [];
  const latest = conversations[0]?.id;
  if (!report("conversation list", listed.ok && latest !== undefined, `HTTP ${listed.status}, ${conversations.length} listed`)) {
    return false;
  }
  const attached = await untilAttached(headers, latest);
  let passed = report("attached to Hermes gateway", attached.ok, `HTTP ${attached.status}`);
  for (const check of CHECKS) {
    const response = await get(headers, check.path(latest));
    passed = report(check.name, response.ok, `HTTP ${response.status}`) && passed;
  }
  return (await deliversToHellum()) && passed;
}

async function deliversToHellum(): Promise<boolean> {
  const { targets } = await runHermesHelper(config.hermesHelpers, "cron", { action: "delivery_targets" }, DeliveryTargetsSchema);
  const hellum = targets.find((target) => target.id === "hellum");
  return report("Hermes delivers to Hellum", hellum?.home_target_set === true, hellum ? "hellum platform connected" : "hellum plugin not loaded");
}

let passed = false;
try {
  passed = await run();
} catch (error) {
  report("check", false, error instanceof Error ? error.message : String(error));
} finally {
  await bridge.stop();
  await rm(stateDir, { recursive: true, force: true });
}
process.stdout.write(passed ? "Hellum works against the running Hermes.\n" : "Hellum does NOT work against the running Hermes.\n");
process.exit(passed ? 0 : 1);
