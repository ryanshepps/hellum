import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { z } from "zod";
import type { GatewayCommand } from "./hermes/gateway-process";
import type { HelperCommand } from "./hermes/helper-process";

const DEFAULT_HERMES_AGENT_DIR = join(homedir(), ".hermes", "hermes-agent");

const ArgvSchema = z.array(z.string().min(1)).min(1);

const EnvSchema = z.object({
  HELLUM_HOST: z.string().default("127.0.0.1"),
  HELLUM_PORT: z.coerce.number().int().min(0).max(65535).default(7870),
  HELLUM_WEB_DIST: z.string().default(resolve(import.meta.dir, "../../clients/web/dist")),
  HELLUM_STATE_DIR: z.string().default(join(homedir(), ".hellum")),
  HELLUM_ASSISTANT_NAME: z.string().min(1).default("Hellum"),
  HELLUM_ASSISTANT_ID: z.string().regex(/^[a-z0-9-]+$/).default("hellum"),
  HELLUM_HERMES_AGENT_DIR: z.string().default(DEFAULT_HERMES_AGENT_DIR),
  HELLUM_HERMES_GATEWAY_ARGV: z.string().optional(),
  HELLUM_HERMES_HELPER_ARGV: z.string().optional(),
  HELLUM_APNS_KEY_PATH: z.string().optional(),
  HELLUM_APNS_KEY_ID: z.string().regex(/^[A-Z0-9]{10}$/).optional(),
  HELLUM_APNS_TEAM_ID: z.string().regex(/^[A-Z0-9]{10}$/).optional(),
  HELLUM_APNS_ORIGIN: z.url().optional(),
});

export type ApnsConfig = {
  readonly keyPath: string;
  readonly keyId: string;
  readonly teamId: string;
  readonly originOverride: string | null;
};

export type BridgeConfig = {
  readonly host: string;
  readonly port: number;
  readonly webDistDir: string;
  readonly stateDir: string;
  readonly assistantName: string;
  readonly assistantId: string;
  readonly hermesGateway: GatewayCommand;
  readonly hermesHelpers: HelperCommand;
  readonly apns: ApnsConfig | null;
};

function gatewayArgv(agentDir: string, override: string | undefined): readonly string[] {
  return override ? ArgvSchema.parse(JSON.parse(override)) : [join(agentDir, "venv", "bin", "python"), "-m", "tui_gateway.entry"];
}

function apnsConfig(parsed: z.infer<typeof EnvSchema>): ApnsConfig | null {
  const { HELLUM_APNS_KEY_PATH: keyPath, HELLUM_APNS_KEY_ID: keyId, HELLUM_APNS_TEAM_ID: teamId } = parsed;
  if (!keyPath && !keyId && !teamId) {
    return null;
  }
  if (!keyPath || !keyId || !teamId) {
    throw new Error("Set all of HELLUM_APNS_KEY_PATH, HELLUM_APNS_KEY_ID, and HELLUM_APNS_TEAM_ID to enable push");
  }
  return { keyPath, keyId, teamId, originOverride: parsed.HELLUM_APNS_ORIGIN ?? null };
}

export function loadConfig(env: Readonly<Record<string, string | undefined>>): BridgeConfig {
  const parsed = EnvSchema.parse(env);
  return {
    host: parsed.HELLUM_HOST,
    port: parsed.HELLUM_PORT,
    webDistDir: parsed.HELLUM_WEB_DIST,
    stateDir: parsed.HELLUM_STATE_DIR,
    assistantName: parsed.HELLUM_ASSISTANT_NAME,
    assistantId: parsed.HELLUM_ASSISTANT_ID,
    hermesGateway: {
      argv: gatewayArgv(parsed.HELLUM_HERMES_AGENT_DIR, parsed.HELLUM_HERMES_GATEWAY_ARGV),
      cwd: parsed.HELLUM_HERMES_AGENT_DIR,
      env,
    },
    hermesHelpers: {
      interpreter: parsed.HELLUM_HERMES_HELPER_ARGV
        ? ArgvSchema.parse(JSON.parse(parsed.HELLUM_HERMES_HELPER_ARGV))
        : [join(parsed.HELLUM_HERMES_AGENT_DIR, "venv", "bin", "python")],
      scriptsDir: resolve(import.meta.dir, "../hermes-helpers"),
      cwd: parsed.HELLUM_HERMES_AGENT_DIR,
      env,
    },
    apns: apnsConfig(parsed),
  };
}
