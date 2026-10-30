import type { ModelService } from "../models/model-service";
import type { HermesSettings } from "./hermes-settings";

export class CredentialService {
  constructor(
    private readonly models: ModelService,
    private readonly hermes: HermesSettings,
    private readonly envByName: Readonly<Record<string, string>>,
  ) {}

  async save(name: string, value: string): Promise<void> {
    const env = this.envByName[name];
    if (env) {
      await this.hermes.write({ env: { [env]: value } });
      return;
    }
    await this.models.saveSecret(name, value);
  }

  async has(name: string): Promise<boolean> {
    const env = this.envByName[name];
    if (env) {
      return (await this.hermes.read([], [env])).env[env] ?? false;
    }
    return this.models.hasSecret(name);
  }
}
