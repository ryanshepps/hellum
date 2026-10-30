// Static catalog of web search providers available in the AI settings page.
// Mirrors the web_search backends Hermes ships (tools/web_tools.py); the
// bridge maps each id onto Hermes' web.search_backend.

/** Ordered list of provider ids — drives the picker option order. */
export const WEB_SEARCH_PROVIDER_IDS: readonly string[] = [
  "inference-provider-native",
  "exa",
  "parallel",
  "tavily",
  "perplexity",
  "firecrawl",
  "keenable",
  "brave",
  "searxng",
  "ddgs",
];

/** Short display name used in picker UI. */
export const WEB_SEARCH_PROVIDER_DISPLAY_NAMES: Readonly<
  Record<string, string>
> = {
  "inference-provider-native": "Automatic",
  exa: "Exa",
  parallel: "Parallel",
  tavily: "Tavily",
  perplexity: "Perplexity",
  firecrawl: "Firecrawl",
  keenable: "Keenable",
  brave: "Brave",
  searxng: "SearXNG",
  ddgs: "DuckDuckGo",
};

/** Placeholder hint shown in the API-key input. BYOK providers only. */
export const WEB_SEARCH_PROVIDER_KEY_PLACEHOLDERS: Readonly<
  Record<string, string>
> = {
  exa: "Exa API key...",
  parallel: "Parallel API key...",
  tavily: "tvly-...",
  perplexity: "pplx-...",
  firecrawl: "fc-...",
  keenable: "keen_... (optional)",
  brave: "BSA...",
};

/** localStorage key used to persist each BYOK provider's user-supplied key. */
export const WEB_SEARCH_PROVIDER_KEY_STORAGE: Readonly<Record<string, string>> =
  {
    exa: "vellum:ai:exaKey",
    parallel: "vellum:ai:parallelKey",
    tavily: "vellum:ai:tavilyKey",
    perplexity: "vellum:ai:perplexityKey",
    firecrawl: "vellum:ai:firecrawlKey",
    keenable: "vellum:ai:keenableKey",
    brave: "vellum:ai:braveKey",
  };

/** Provider ids that require a user-supplied API key. */
export const WEB_SEARCH_BYOK_PROVIDER_IDS: ReadonlySet<string> = new Set([
  "exa",
  "parallel",
  "tavily",
  "perplexity",
  "firecrawl",
  "keenable",
  "brave",
]);

/**
 * BYOK providers that also work without a stored key (key is optional).
 * Save is not gated on a credential for these.
 */
export const WEB_SEARCH_KEYLESS_BYOK_PROVIDER_IDS: ReadonlySet<string> =
  new Set(["keenable"]);

/** Provider ids that show an optional API Base field in settings. */
export const WEB_SEARCH_API_BASE_PROVIDER_IDS: ReadonlySet<string> = new Set([
  "searxng",
]);

/** Cloud default API origin when API Base is left empty. */
export const WEB_SEARCH_PROVIDER_DEFAULT_API_BASE: Readonly<
  Record<string, string>
> = {};
