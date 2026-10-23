import { join } from "node:path";
import { z } from "zod";
import { privateJsonFile } from "../storage/json-file";

const RegistrationSchema = z.object({
  token: z.string().regex(/^[0-9a-fA-F]{32,200}$/),
  bundleId: z.string().min(1),
  environment: z.enum(["development", "production"]),
  registeredAt: z.number(),
});

const RegistrySchema = z.object({ registrations: z.array(RegistrationSchema) });

export type PushRegistration = z.infer<typeof RegistrationSchema>;

export class PushTokenRegistry {
  private constructor(
    private registrations: readonly PushRegistration[],
    private readonly save: (registrations: readonly PushRegistration[]) => Promise<void>,
  ) {}

  static async open(stateDir: string): Promise<PushTokenRegistry> {
    const file = privateJsonFile(join(stateDir, "push-tokens.json"), RegistrySchema, { registrations: [] });
    const { registrations } = await file.read();
    return new PushTokenRegistry(registrations, (next) => file.write({ registrations: [...next] }));
  }

  list(): readonly PushRegistration[] {
    return this.registrations;
  }

  upsert(registration: PushRegistration): Promise<void> {
    this.registrations = [...this.registrations.filter((existing) => existing.token !== registration.token), registration];
    return this.save(this.registrations);
  }

  remove(token: string): Promise<void> {
    this.registrations = this.registrations.filter((existing) => existing.token !== token);
    return this.save(this.registrations);
  }
}
