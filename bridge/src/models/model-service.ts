import { z } from "zod";
import { runHermesHelper, type HelperCommand } from "../hermes/helper-process";
import type { HermesGateway } from "../hermes/hermes-gateway";
import type { JsonFile } from "../storage/json-file";
import {
  HermesProviderSchema,
  applyLlmPatch,
  connectedProviders,
  connectionView,
  hermesProvider,
  hermesSlugForSecretName,
  llmConfig,
  modelCatalog,
  profileHermesProvider,
  withHermesProfile,
  type HermesModelStatus,
  type LlmPatch,
  type ProfileStore,
} from "../translate/inference";

const StatusResultSchema = z.object({
  success: z.literal(true),
  model: z.string(),
  provider: z.string(),
  providers: z.array(HermesProviderSchema),
});
const WriteResultSchema = z.object({ success: z.boolean(), error: z.string().nullable() });
export class ModelSettingRejectedError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "ModelSettingRejectedError";
  }
}

export class ProfileNotFoundError extends Error {
  constructor(name: string) {
    super(`No profile ${name}`);
    this.name = "ProfileNotFoundError";
  }
}

export type LlmConfigPatch = LlmPatch & { readonly activeProfile?: string | undefined };

export class ModelService {
  constructor(
    private readonly helper: HelperCommand,
    private readonly gateway: HermesGateway,
    private readonly store: JsonFile<ProfileStore>,
    private readonly onModelChanged: () => Promise<void>,
  ) {}

  async llm() {
    const status = await this.status();
    return llmConfig(await this.profiles(status), status);
  }

  async patchLlm(patch: LlmConfigPatch) {
    const status = await this.status();
    const before = await this.profiles(status);
    const activeBefore = llmConfig(before, status).activeProfile;
    const after = applyLlmPatch(before, patch);
    await this.store.write(after);
    const target = patch.activeProfile ?? activeBefore;
    if (target && (patch.activeProfile !== undefined || patch.profiles?.[target] !== undefined)) {
      await this.activate(after, target);
    }
    return this.llm();
  }

  async setActiveProfile(name: string): Promise<string> {
    await this.activate(await this.profiles(await this.status()), name);
    return name;
  }

  async connections() {
    return connectedProviders(await this.status()).map(connectionView);
  }

  async connection(name: string) {
    const found = (await this.connections()).find((connection) => connection.name === name);
    if (!found) {
      throw new ProfileNotFoundError(name);
    }
    return found;
  }

  async models() {
    return modelCatalog(await this.status());
  }

  async connectionForProvider(vellumProvider: string, name: string) {
    const slug = hermesProvider(vellumProvider) ?? hermesProvider(name) ?? name;
    const found = (await this.connections()).find((connection) => connection.name === slug);
    if (!found) {
      throw new ModelSettingRejectedError(`Add an API key for ${vellumProvider} before creating its provider`);
    }
    return found;
  }

  async saveSecret(name: string, value: string): Promise<void> {
    const slug = hermesSlugForSecretName(name);
    if (!slug) {
      throw new ModelSettingRejectedError(`Hermes has no provider for ${name}`);
    }
    await this.write({ action: "save_key", provider: slug, api_key: value });
  }

  async hasSecret(name: string): Promise<boolean> {
    const slug = hermesSlugForSecretName(name);
    return slug !== null && (await this.status()).providers.some((provider) => provider.slug === slug && provider.authenticated);
  }

  async secretNames(): Promise<readonly string[]> {
    return (await this.connections()).flatMap((connection) => (connection.auth.type === "api_key" ? [`${connection.provider}:api_key`] : []));
  }

  async disconnect(name: string): Promise<void> {
    const status = await this.status();
    if (name === status.provider) {
      throw new ModelSettingRejectedError("Hermes is using this provider. Switch to another profile before removing it.");
    }
    await this.write({ action: "disconnect", provider: name });
  }

  private async activate(store: ProfileStore, name: string): Promise<void> {
    const entry = store.profiles[name];
    if (!entry) {
      throw new ProfileNotFoundError(name);
    }
    const provider = profileHermesProvider(entry);
    if (!entry.model || !provider) {
      throw new ModelSettingRejectedError(`Profile ${name} needs a provider and a model`);
    }
    await this.write({ action: "set_default", provider, model: entry.model });
    await this.onModelChanged();
  }

  private async profiles(status: HermesModelStatus): Promise<ProfileStore> {
    const stored = await this.store.read();
    const seeded = withHermesProfile(stored, status);
    if (seeded !== stored) {
      await this.store.write(seeded);
    }
    return seeded;
  }

  private status(): Promise<HermesModelStatus> {
    return runHermesHelper(this.helper, "models", { action: "status" }, StatusResultSchema);
  }

  private async write(request: object): Promise<void> {
    const result = await runHermesHelper(this.helper, "models", request, WriteResultSchema);
    if (!result.success) {
      throw new ModelSettingRejectedError(result.error ?? "Hermes rejected the change");
    }
    await this.gateway.request("reload.env", {}, z.unknown());
  }
}
