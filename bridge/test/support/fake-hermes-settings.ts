import { existsSync, readFileSync, writeFileSync } from "node:fs";

export type SettingsState = { values: Record<string, unknown>; env: Record<string, string> };

export type SettingsRequest = {
  action: string;
  keys?: string[];
  env?: string[] | Record<string, string>;
  reveal?: string[];
  set?: Record<string, string>;
  unset?: string[];
  env_unset?: string[];
};

function stateFile(): string {
  return process.env.FAKE_HERMES_SETTINGS_FILE ?? "";
}

export function readSettingsState(path = stateFile()): SettingsState {
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : { values: {}, env: {} };
}

export function writeSettingsState(state: SettingsState, path = stateFile()): void {
  writeFileSync(path, JSON.stringify(state));
}

export function handleSettings(request: SettingsRequest): object {
  const state = readSettingsState();
  switch (request.action) {
    case "read":
      return {
        success: true,
        values: Object.fromEntries((request.keys ?? []).map((key) => [key, state.values[key] ?? null])),
        env: Object.fromEntries(((request.env as string[] | undefined) ?? []).map((name) => [name, Boolean(state.env[name])])),
        revealed: Object.fromEntries((request.reveal ?? []).map((name) => [name, state.env[name] ?? ""])),
      };
    case "write": {
      if (Object.values(request.set ?? {}).includes("refuse")) {
        return { success: false, error: "Hermes refused the value" };
      }
      Object.assign(state.values, request.set ?? {});
      for (const key of request.unset ?? []) {
        delete state.values[key];
      }
      Object.assign(state.env, request.env ?? {});
      for (const name of request.env_unset ?? []) {
        delete state.env[name];
      }
      writeSettingsState(state);
      return { success: true, error: null };
    }
    default:
      return { success: false, error: `unknown action ${request.action}` };
  }
}
