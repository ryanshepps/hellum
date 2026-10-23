import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { z } from "zod";

const EnvSchema = z.object({
  HELLUM_HOST: z.string().default("127.0.0.1"),
  HELLUM_PORT: z.coerce.number().int().min(0).max(65535).default(7870),
  HELLUM_WEB_DIST: z.string().default(resolve(import.meta.dir, "../../clients/web/dist")),
  HELLUM_STATE_DIR: z.string().default(join(homedir(), ".hellum")),
  HELLUM_ASSISTANT_NAME: z.string().min(1).default("Hellum"),
  HELLUM_ASSISTANT_ID: z.string().regex(/^[a-z0-9-]+$/).default("hellum"),
});

export type BridgeConfig = {
  readonly host: string;
  readonly port: number;
  readonly webDistDir: string;
  readonly stateDir: string;
  readonly assistantName: string;
  readonly assistantId: string;
};

export function loadConfig(env: Readonly<Record<string, string | undefined>>): BridgeConfig {
  const parsed = EnvSchema.parse(env);
  return {
    host: parsed.HELLUM_HOST,
    port: parsed.HELLUM_PORT,
    webDistDir: parsed.HELLUM_WEB_DIST,
    stateDir: parsed.HELLUM_STATE_DIR,
    assistantName: parsed.HELLUM_ASSISTANT_NAME,
    assistantId: parsed.HELLUM_ASSISTANT_ID,
  };
}
