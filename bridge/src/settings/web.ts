import { z } from "zod";
import { SettingRejectedError, type HermesSettingsChange } from "./hermes-settings";
import { combineChanges, type SettingsSection } from "./settings-service";

const AUTOMATIC_SEARCH = "inference-provider-native";
const AUTOMATIC_FETCH = "default";
const SEARXNG_URL = "SEARXNG_URL";

const HERMES_SEARCH_BACKEND: Readonly<Record<string, string>> = {
  exa: "exa",
  parallel: "parallel",
  tavily: "tavily",
  perplexity: "perplexity",
  firecrawl: "firecrawl",
  keenable: "keenable",
  brave: "brave-free",
  searxng: "searxng",
  ddgs: "ddgs",
};

const HERMES_EXTRACT_BACKEND: Readonly<Record<string, string>> = {
  firecrawl: "firecrawl",
  tavily: "tavily",
  exa: "exa",
  parallel: "parallel",
  keenable: "keenable",
};

export const WEB_KEY_ENV: Readonly<Record<string, string>> = {
  exa: "EXA_API_KEY",
  parallel: "PARALLEL_API_KEY",
  tavily: "TAVILY_API_KEY",
  perplexity: "PERPLEXITY_API_KEY",
  firecrawl: "FIRECRAWL_API_KEY",
  keenable: "KEENABLE_API_KEY",
  brave: "BRAVE_SEARCH_API_KEY",
};

const ServicePatchSchema = z.object({ provider: z.string().optional(), apiBase: z.string().optional() }).passthrough();
const WebPatchSchema = z.object({
  services: z.object({ "web-search": ServicePatchSchema.optional(), "web-fetch": ServicePatchSchema.optional() }).passthrough(),
});

function vellumId(backends: Readonly<Record<string, string>>, hermes: unknown, automatic: string): string {
  if (typeof hermes !== "string" || !hermes) {
    return automatic;
  }
  return Object.entries(backends).find(([, backend]) => backend === hermes)?.[0] ?? hermes;
}

function backendChange(key: string, backends: Readonly<Record<string, string>>, provider: string, automatic: string): HermesSettingsChange {
  if (provider === automatic) {
    return { unset: [key] };
  }
  const backend = backends[provider];
  if (!backend) {
    throw new SettingRejectedError(`Hermes has no ${provider} backend`);
  }
  return { set: { [key]: backend } };
}

function searxngUrl(apiBase: string): HermesSettingsChange {
  const trimmed = apiBase.trim();
  if (!URL.canParse(trimmed) || !/^https?:$/.test(new URL(trimmed).protocol)) {
    throw new SettingRejectedError("SearXNG needs the http(s) address of your instance");
  }
  return { env: { [SEARXNG_URL]: trimmed } };
}

export const webSection: SettingsSection = {
  keys: ["web.search_backend", "web.extract_backend"],
  reveal: [SEARXNG_URL],
  view: ({ values, revealed }) => ({
    services: {
      "web-search": {
        provider: vellumId(HERMES_SEARCH_BACKEND, values["web.search_backend"], AUTOMATIC_SEARCH),
        mode: "your-own",
        apiBase: revealed[SEARXNG_URL] ?? "",
      },
      "web-fetch": { provider: vellumId(HERMES_EXTRACT_BACKEND, values["web.extract_backend"], AUTOMATIC_FETCH) },
    },
  }),
  change: (patch) => {
    const parsed = WebPatchSchema.safeParse(patch);
    if (!parsed.success) {
      return null;
    }
    const search = parsed.data.services["web-search"];
    const fetch = parsed.data.services["web-fetch"];
    const changes: HermesSettingsChange[] = [
      ...(search?.provider ? [backendChange("web.search_backend", HERMES_SEARCH_BACKEND, search.provider, AUTOMATIC_SEARCH)] : []),
      ...(search?.provider === "searxng" && search.apiBase !== undefined ? [searxngUrl(search.apiBase)] : []),
      ...(fetch?.provider ? [backendChange("web.extract_backend", HERMES_EXTRACT_BACKEND, fetch.provider, AUTOMATIC_FETCH)] : []),
    ];
    return changes.length > 0 ? combineChanges(changes) : null;
  },
};
