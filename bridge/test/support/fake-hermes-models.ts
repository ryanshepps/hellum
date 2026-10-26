import { existsSync, readFileSync, writeFileSync } from "node:fs";

export type ModelState = { model: string; provider: string; keys: Record<string, boolean> };

export type ModelsRequest = { action: string; provider?: string; api_key?: string; model?: string };

const PROVIDERS = [
  { slug: "openrouter", name: "OpenRouter", key: true, virtual: false, models: ["@preset/vellum-main", "anthropic/claude-sonnet-5"] },
  { slug: "moa", name: "Mixture of Agents", key: false, virtual: true, models: ["default"] },
  { slug: "anthropic", name: "Anthropic", key: true, virtual: false, models: ["claude-sonnet-4-6"] },
  { slug: "deepseek", name: "DeepSeek", key: true, virtual: false, models: [] },
];

const INITIAL: ModelState = { model: "@preset/vellum-main", provider: "openrouter", keys: { openrouter: true, moa: true, anthropic: true } };

function stateFile(): string {
  return process.env.FAKE_HERMES_MODELS_FILE ?? "";
}

export function readModelState(): ModelState {
  return existsSync(stateFile()) ? JSON.parse(readFileSync(stateFile(), "utf8")) : structuredClone(INITIAL);
}

export function writeModelState(state: ModelState): void {
  writeFileSync(stateFile(), JSON.stringify(state));
}

export function handleModels(request: ModelsRequest): object {
  const state = readModelState();
  const provider = PROVIDERS.find((candidate) => candidate.slug === request.provider);
  switch (request.action) {
    case "status":
      return {
        success: true,
        model: state.model,
        provider: state.provider,
        providers: PROVIDERS.map((row) => ({
          slug: row.slug,
          name: row.name,
          authenticated: Boolean(state.keys[row.slug]),
          key_managed: row.key,
          virtual: row.virtual,
          models: state.keys[row.slug] ? row.models : [],
        })),
      };
    case "save_key":
      if (!provider?.key) {
        return { success: false, error: `Hermes does not take an API key for ${request.provider}` };
      }
      writeModelState({ ...state, keys: { ...state.keys, [provider.slug]: true } });
      return { success: true, error: null };
    case "disconnect":
      if (!provider || !state.keys[provider.slug]) {
        return { success: false, error: `No credentials found for ${request.provider}` };
      }
      writeModelState({ ...state, keys: { ...state.keys, [provider.slug]: false } });
      return { success: true, error: null };
    case "set_default":
      if (!provider || !state.keys[provider.slug]) {
        return { success: false, error: `No credentials for provider '${request.provider}'` };
      }
      writeModelState({ ...state, model: request.model ?? "", provider: provider.slug });
      return { success: true, error: null };
    default:
      return { success: false, error: `unknown action ${request.action}` };
  }
}
