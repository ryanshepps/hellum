import { mkdtemp, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { chromium, type Page } from "playwright";
import { z } from "zod";
import { loadConfig } from "../src/config";
import { startBridge } from "../src/server";

const REPLY_TIMEOUT_MS = 120_000;
const RED_PNG = join(import.meta.dir, "fixtures", "red.png");
const MARKER = `hellum-e2e-${Date.now().toString(36)}`;

function check(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(`E2E failed: ${message}`);
  }
}

async function pairingLink(baseUrl: URL, socketPath: string): Promise<string> {
  const response = await fetch("http://hellum/pairings", { method: "POST", unix: socketPath });
  const { deviceCode } = z.object({ deviceCode: z.string() }).parse(await response.json());
  return `${new URL("/assistant/pair", baseUrl).toString()}#device_code=${encodeURIComponent(deviceCode)}`;
}

async function deleteConversation(baseUrl: URL, socketPath: string, conversationId: string): Promise<void> {
  const created = await fetch("http://hellum/pairings", { method: "POST", unix: socketPath });
  const { deviceCode } = z.object({ deviceCode: z.string() }).parse(await created.json());
  const exchanged = await fetch(new URL("/v1/remote-web/pairing-token", baseUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ deviceCode, clientReportedName: "hellum e2e cleanup" }),
  });
  const { accessToken } = z.object({ accessToken: z.string() }).parse(await exchanged.json());
  const deleted = await fetch(new URL(`/v1/assistants/self/conversations/${encodeURIComponent(conversationId)}`, baseUrl), {
    method: "DELETE",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  check(deleted.ok, `could not delete the e2e conversation ${conversationId}: ${deleted.status}`);
}

function conversationIdFrom(url: string): string {
  const match = /\/assistant\/conversations\/([^/?#]+)/.exec(new URL(url).pathname);
  check(match?.[1] !== undefined, `no conversation id in ${url}`);
  return decodeURIComponent(match[1]);
}

async function startNewChat(page: Page): Promise<void> {
  await page.goto(page.url().replace(/\/assistant\/.*$/, "/assistant/"));
  await page.getByRole("button", { name: /new (chat|conversation)/i }).first().click();
}

const stateDir = await mkdtemp(join(homedir(), ".hellum-e2e-"));
const bridge = await startBridge(loadConfig({ ...process.env, HELLUM_PORT: "0", HELLUM_STATE_DIR: stateDir }));
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(await pairingLink(bridge.url, bridge.adminSocketPath));
  await page.waitForURL(/\/assistant\/(?!pair)/, { timeout: 30_000 });
  process.stdout.write("paired\n");

  await startNewChat(page);
  const composer = page.getByRole("textbox").first();
  await composer.fill(`Reply with exactly this text and nothing else: ${MARKER}`);
  await composer.press("Enter");
  process.stdout.write("sent\n");

  await page.getByText(MARKER, { exact: true }).last().waitFor({ timeout: REPLY_TIMEOUT_MS });
  const bubbles = await page.getByText(MARKER).count();
  check(bubbles >= 2, `expected the prompt and the reply to mention the marker, saw ${bubbles}`);
  process.stdout.write("reply rendered\n");

  await page.reload();
  await page.getByText(MARKER, { exact: true }).last().waitFor({ timeout: 30_000 });
  process.stdout.write("reply survives reload\n");
  await page.screenshot({ path: join(stateDir, "chat.png") });
  await deleteConversation(bridge.url, bridge.adminSocketPath, conversationIdFrom(page.url()));

  await startNewChat(page);
  await page.locator("input[type=file]").first().setInputFiles(RED_PNG);
  const imageComposer = page.getByRole("textbox").first();
  await imageComposer.fill("What color is this image? Answer with one word.");
  await imageComposer.press("Enter");
  await page.getByText(/^red\.?$/i).last().waitFor({ timeout: REPLY_TIMEOUT_MS });
  process.stdout.write("image attachment understood\n");
  await page.screenshot({ path: join(stateDir, "image.png") });
  await deleteConversation(bridge.url, bridge.adminSocketPath, conversationIdFrom(page.url()));
  process.stdout.write(`PASS (screenshots in ${stateDir})\n`);
} finally {
  await browser.close();
  await bridge.stop();
  if (process.env.HELLUM_E2E_KEEP !== "1") {
    await rm(stateDir, { recursive: true, force: true });
  }
}
