// Static catalog of web fetch providers available in the AI settings page.
// Mirrors the web_extract backends Hermes ships (tools/web_tools_extract.py);
// the bridge maps each id onto Hermes' web.extract_backend.

/** Ordered list of provider ids — drives the picker option order. */
export const WEB_FETCH_PROVIDER_IDS: readonly string[] = [
  "default",
  "firecrawl",
  "tavily",
  "exa",
  "parallel",
  "keenable",
];

/** Short display name used in picker UI. */
export const WEB_FETCH_PROVIDER_DISPLAY_NAMES: Readonly<
  Record<string, string>
> = {
  default: "Automatic",
  firecrawl: "Firecrawl",
  tavily: "Tavily",
  exa: "Exa",
  parallel: "Parallel",
  keenable: "Keenable",
};

/** Placeholder hint shown in the API-key input. BYOK providers only. */
export const WEB_FETCH_PROVIDER_KEY_PLACEHOLDERS: Readonly<
  Record<string, string>
> = {
  firecrawl: "fc-...",
  tavily: "tvly-...",
  exa: "Exa API key...",
  parallel: "Parallel API key...",
};

/**
 * localStorage key used to persist each BYOK provider's user-supplied key.
 * Each provider shares its key slot with web search. One stored credential
 * powers both tools.
 */
export const WEB_FETCH_PROVIDER_KEY_STORAGE: Readonly<Record<string, string>> =
  {
    firecrawl: "vellum:ai:firecrawlKey",
    tavily: "vellum:ai:tavilyKey",
    exa: "vellum:ai:exaKey",
    parallel: "vellum:ai:parallelKey",
  };

/** Provider ids that require a user-supplied API key. */
export const WEB_FETCH_BYOK_PROVIDER_IDS: ReadonlySet<string> = new Set([
  "firecrawl",
  "tavily",
  "exa",
  "parallel",
]);

/** Provider ids that show an optional API Base field in settings. */
export const WEB_FETCH_API_BASE_PROVIDER_IDS: ReadonlySet<string> = new Set();

/** Cloud default API origin when API Base is left empty. */
export const WEB_FETCH_PROVIDER_DEFAULT_API_BASE: Readonly<
  Record<string, string>
> = {};
