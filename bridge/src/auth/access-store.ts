import { join } from "node:path";
import { z } from "zod";
import { privateJsonFile } from "../storage/json-file";
import type { AccessSessions } from "./access-sessions";
import type { TokenHash } from "./tokens";

const AccessFileSchema = z.object({
  sessions: z.array(z.object({ tokenHash: z.string().regex(/^[0-9a-f]{64}$/), deviceId: z.string().min(1), expiresAt: z.number() })),
});

export type AccessStore = {
  readonly load: () => Promise<AccessSessions>;
  readonly save: (sessions: AccessSessions) => Promise<void>;
};

export function createFileAccessStore(stateDir: string): AccessStore {
  const file = privateJsonFile(join(stateDir, "access-tokens.json"), AccessFileSchema, { sessions: [] });
  return {
    load: async () => new Map((await file.read()).sessions.map(({ tokenHash, ...session }) => [tokenHash as TokenHash, session])),
    save: (sessions) => file.write({ sessions: [...sessions].map(([tokenHash, session]) => ({ tokenHash, ...session })) }),
  };
}
