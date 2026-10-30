import type { HermesSettings, HermesSettingsChange, HermesSettingsSnapshot } from "./hermes-settings";

export type ConfigPatch = Readonly<Record<string, unknown>>;

export type SettingsSection = {
  readonly keys: readonly string[];
  readonly env?: readonly string[];
  readonly view: (snapshot: HermesSettingsSnapshot) => object;
  readonly change: (patch: ConfigPatch) => HermesSettingsChange | null;
};

type Json = Readonly<Record<string, unknown>>;

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function mergeDeep(base: Json, overlay: Json): Json {
  const merged: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(overlay)) {
    const existing = merged[key];
    merged[key] = isObject(existing) && isObject(value) ? mergeDeep(existing, value) : value;
  }
  return merged;
}

function combine(changes: readonly HermesSettingsChange[]): HermesSettingsChange {
  return {
    set: Object.assign({}, ...changes.map((change) => change.set ?? {})),
    unset: changes.flatMap((change) => change.unset ?? []),
    env: Object.assign({}, ...changes.map((change) => change.env ?? {})),
    envUnset: changes.flatMap((change) => change.envUnset ?? []),
  };
}

export class SettingsService {
  constructor(
    private readonly hermes: HermesSettings,
    private readonly sections: readonly SettingsSection[],
  ) {}

  async view(): Promise<Json> {
    const snapshot = await this.hermes.read(
      [...new Set(this.sections.flatMap((section) => section.keys))],
      [...new Set(this.sections.flatMap((section) => section.env ?? []))],
    );
    return this.sections.reduce<Json>((view, section) => mergeDeep(view, section.view(snapshot) as Json), {});
  }

  async apply(patch: ConfigPatch): Promise<void> {
    const changes = this.sections.flatMap((section) => section.change(patch) ?? []);
    if (changes.length > 0) {
      await this.hermes.write(combine(changes));
    }
  }
}
