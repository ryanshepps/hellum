import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { z } from "zod";
import { privateJsonFile } from "./storage/json-file";

const IdentitySchema = z.object({ platformAssistantId: z.uuid() });

export type BridgeIdentity = z.infer<typeof IdentitySchema>;

export async function loadIdentity(stateDir: string): Promise<BridgeIdentity> {
  const file = privateJsonFile<BridgeIdentity | null>(join(stateDir, "identity.json"), IdentitySchema.nullable(), null);
  const existing = await file.read();
  if (existing) {
    return existing;
  }
  const created = { platformAssistantId: randomUUID() };
  await file.write(created);
  return created;
}
