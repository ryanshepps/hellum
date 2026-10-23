import { z } from "zod";

export const HermesProviderSchema = z.object({
  slug: z.string(),
  name: z.string(),
  authenticated: z.boolean(),
  key_managed: z.boolean(),
  virtual: z.boolean(),
  models: z.array(z.string()),
});
export type HermesProvider = z.infer<typeof HermesProviderSchema>;

export type HermesModelStatus = {
  readonly model: string;
  readonly provider: string;
  readonly providers: readonly HermesProvider[];
};

export const ProfileEntrySchema = z
  .object({
    label: z.string().optional(),
    provider: z.string().optional(),
    provider_connection: z.string().optional(),
    model: z.string().optional(),
  })
  .passthrough();
export type ProfileEntry = z.infer<typeof ProfileEntrySchema>;

export const ProfileStoreSchema = z.object({
  profiles: z.record(z.string(), ProfileEntrySchema),
  profileOrder: z.array(z.string()),
});
export type ProfileStore = z.infer<typeof ProfileStoreSchema>;

export const EMPTY_PROFILE_STORE: ProfileStore = { profiles: {}, profileOrder: [] };

const VELLUM_PROVIDER_FOR_HERMES: Readonly<Record<string, string>> = {
  openrouter: "openrouter",
  anthropic: "anthropic",
  "openai-api": "openai",
  gemini: "gemini",
  fireworks: "fireworks",
  minimax: "minimax",
  "ollama-cloud": "ollama",
};

const FALLBACK_VELLUM_PROVIDER = "openai-compatible";
const HERMES_PROFILE_NAME = "hermes";

export function vellumProvider(hermesSlug: string): string {
  return VELLUM_PROVIDER_FOR_HERMES[hermesSlug] ?? FALLBACK_VELLUM_PROVIDER;
}

export function hermesProvider(vellumProviderOrConnection: string): string | null {
  const byVellum = Object.entries(VELLUM_PROVIDER_FOR_HERMES).find(([, vellum]) => vellum === vellumProviderOrConnection);
  return byVellum?.[0] ?? null;
}

export function profileHermesProvider(entry: ProfileEntry): string | null {
  return entry.provider_connection ?? (entry.provider ? hermesProvider(entry.provider) ?? entry.provider : null);
}

function matchesHermes(entry: ProfileEntry, status: Pick<HermesModelStatus, "model" | "provider">): boolean {
  return entry.model === status.model && profileHermesProvider(entry) === status.provider;
}

export function activeProfileName(store: ProfileStore, status: Pick<HermesModelStatus, "model" | "provider">): string | null {
  const ordered = [...store.profileOrder, ...Object.keys(store.profiles).filter((name) => !store.profileOrder.includes(name))];
  return ordered.find((name) => {
    const entry = store.profiles[name];
    return entry !== undefined && matchesHermes(entry, status);
  }) ?? null;
}

function unusedName(store: ProfileStore): string {
  let name = HERMES_PROFILE_NAME;
  for (let suffix = 2; name in store.profiles; suffix += 1) {
    name = `${HERMES_PROFILE_NAME}-${suffix}`;
  }
  return name;
}

export function withHermesProfile(store: ProfileStore, status: Pick<HermesModelStatus, "model" | "provider">): ProfileStore {
  if (!status.model || activeProfileName(store, status) !== null) {
    return store;
  }
  const name = unusedName(store);
  return {
    profiles: {
      ...store.profiles,
      [name]: { label: status.model, provider: vellumProvider(status.provider), provider_connection: status.provider, model: status.model },
    },
    profileOrder: [name, ...store.profileOrder],
  };
}

export type LlmPatch = {
  readonly profiles?: Readonly<Record<string, ProfileEntry | null>> | undefined;
  readonly profileOrder?: readonly string[] | undefined;
};

export function applyLlmPatch(store: ProfileStore, patch: LlmPatch): ProfileStore {
  const profiles: Record<string, ProfileEntry> = { ...store.profiles };
  for (const [name, entry] of Object.entries(patch.profiles ?? {})) {
    if (entry === null) {
      delete profiles[name];
    } else {
      profiles[name] = { ...profiles[name], ...entry };
    }
  }
  const order = patch.profileOrder ?? store.profileOrder;
  return { profiles, profileOrder: order.filter((name) => name in profiles) };
}

export function llmConfig(store: ProfileStore, status: Pick<HermesModelStatus, "model" | "provider">) {
  const activeProfile = activeProfileName(store, status);
  return {
    profiles: store.profiles,
    profileOrder: store.profileOrder,
    ...(activeProfile ? { activeProfile } : {}),
    defaultProvider: { provider: vellumProvider(status.provider), connectionName: status.provider },
    callSites: {},
  };
}

export function credentialRef(hermesSlug: string): string {
  return `credential/${vellumProvider(hermesSlug)}/api_key`;
}

export function connectionView(provider: HermesProvider) {
  return {
    name: provider.slug,
    provider: vellumProvider(provider.slug),
    auth: provider.key_managed ? { type: "api_key", credential: credentialRef(provider.slug) } : { type: "none" },
    label: provider.name,
    baseUrl: null,
    models: null,
    createdAt: 0,
    updatedAt: 0,
    isManaged: false,
  };
}

export function connectedProviders(status: HermesModelStatus): readonly HermesProvider[] {
  return status.providers.filter((provider) => provider.authenticated && !provider.virtual);
}

export function modelCatalog(status: HermesModelStatus) {
  return connectedProviders(status).flatMap((provider) =>
    provider.models.map((id) => ({ provider: vellumProvider(provider.slug), id, displayName: id })),
  );
}

export function hermesSlugForSecretName(name: string): string | null {
  const service = name.includes(":") ? name.slice(0, name.indexOf(":")) : name;
  return hermesProvider(service);
}
