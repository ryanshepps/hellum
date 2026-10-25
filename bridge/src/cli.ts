#!/usr/bin/env bun
import { buildRemoteWebPairingUrl } from "@vellumai/service-contracts/remote-web-pairing";
import QRCode from "qrcode";
import { z } from "zod";
import { adminSocketPath } from "./admin/admin-server";
import { loadConfig } from "./config";
import { parseSendArgs } from "./notifications/send-command";

const PairingSchema = z.object({ deviceCode: z.string(), userCode: z.string(), expiresAt: z.number() });
const PendingSchema = z.object({ pending: z.array(z.object({ userCode: z.string(), expiresAt: z.number() })) });
const DevicesSchema = z.object({
  devices: z.array(
    z.object({ deviceId: z.string(), name: z.string(), platform: z.string(), pairedAt: z.number(), lastSeenAt: z.number() }),
  ),
});

const SendResultSchema = z.object({
  ok: z.boolean(),
  dispatched: z.boolean(),
  deduplicated: z.boolean(),
  selectedChannels: z.array(z.string()),
  remotePushAccepted: z.boolean(),
});

const USAGE = `Usage: hellum <command>

  pair [public-url]     Print a one-time link that pairs a device (default: HELLUM_PUBLIC_URL)
  pending               List pairing requests waiting for approval
  approve <code>        Approve a pairing request shown on a device
  devices               List paired devices
  revoke <device-id>    Unpair a device
  notifications send --message <text> [--title <title>] [--urgent | --urgency low|medium|high|critical]
                     [--conversation-id <id>] [--session-id <id>] [--source-channel <channel>]
                     [--source-event-name <name>] [--dedupe-key <key>] [--json]
                        Notify your devices, like Vellum's \`assistant notifications send\`.
                        Only high or critical urgency (or --urgent) reaches a locked phone.`;

const config = loadConfig(process.env);
const socketPath = adminSocketPath(config.stateDir);

async function admin(method: "GET" | "POST" | "DELETE", path: string, body?: object): Promise<unknown> {
  const init: RequestInit & { unix: string } = { method, unix: socketPath };
  const response = await fetch(`http://hellum${path}`, body ? { ...init, body: JSON.stringify(body) } : init).catch(
    (error: unknown) => {
      throw new Error(`Could not reach the bridge at ${socketPath}. Is it running?`, { cause: error });
    },
  );
  const payload: unknown = await response.json();
  if (!response.ok) {
    throw new Error(`Bridge refused ${method} ${path}: ${JSON.stringify(payload)}`);
  }
  return payload;
}

function print(line: string): void {
  process.stdout.write(`${line}\n`);
}

async function pair(publicUrl: string | undefined): Promise<void> {
  const base = publicUrl ?? process.env.HELLUM_PUBLIC_URL;
  if (!base) {
    throw new Error("Pass the bridge's public https URL or set HELLUM_PUBLIC_URL");
  }
  const pairing = PairingSchema.parse(await admin("POST", "/pairings"));
  const baseUrl = base.replace(/\/+$/, "");
  const link = buildRemoteWebPairingUrl({ verificationUri: `${baseUrl}/assistant/pair`, deviceCode: pairing.deviceCode });
  const appLink = `hellum://connect?${new URLSearchParams({ url: baseUrl, code: pairing.deviceCode }).toString().replace(/\+/g, "%20")}`;
  print(await QRCode.toString(appLink, { type: "terminal", small: true }));
  print("Scan with your iPhone camera to pair the Hellum app.");
  print(`App link:     ${appLink}`);
  print(`Browser link: ${link}`);
  print(`Expires:      ${new Date(pairing.expiresAt).toLocaleTimeString()}`);
}

async function sendNotification(args: readonly string[]): Promise<void> {
  const { request, json } = parseSendArgs(args, process.env);
  const result = SendResultSchema.parse(await admin("POST", "/notifications", request));
  if (json) {
    print(JSON.stringify(result));
    return;
  }
  if (result.deduplicated) {
    print("Already sent a notification with that dedupe key.");
    return;
  }
  print(`Sent to ${result.selectedChannels.join(" and ")}${result.remotePushAccepted ? ", Apple accepted the push" : ""}.`);
}

async function run(args: readonly string[]): Promise<void> {
  const [command, argument] = args;
  switch (command) {
    case "notifications":
      if (argument !== "send") {
        throw new Error("Usage: hellum notifications send --message <text> [options]");
      }
      return sendNotification(args.slice(2));
    case "pair":
      return pair(argument);
    case "pending": {
      const { pending } = PendingSchema.parse(await admin("GET", "/pairings"));
      if (pending.length === 0) {
        print("No pending pairing requests.");
      }
      for (const request of pending) {
        print(`${request.userCode}  expires ${new Date(request.expiresAt).toLocaleTimeString()}`);
      }
      return;
    }
    case "approve":
      if (!argument) {
        throw new Error("approve needs the code shown on the device");
      }
      await admin("POST", "/pairings/approve", { userCode: argument });
      print(`Approved ${argument}.`);
      return;
    case "devices": {
      const { devices } = DevicesSchema.parse(await admin("GET", "/devices"));
      if (devices.length === 0) {
        print("No paired devices.");
      }
      for (const device of devices) {
        print(`${device.deviceId}  ${device.platform}  ${device.name}  last seen ${new Date(device.lastSeenAt).toLocaleString()}`);
      }
      return;
    }
    case "revoke":
      if (!argument) {
        throw new Error("revoke needs a device id from `hellum devices`");
      }
      await admin("DELETE", `/devices/${encodeURIComponent(argument)}`);
      print(`Revoked ${argument}.`);
      return;
    default:
      print(USAGE);
  }
}

try {
  await run(process.argv.slice(2));
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
