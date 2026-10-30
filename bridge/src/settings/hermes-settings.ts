import { z } from "zod";
import { runHermesHelper, type HelperCommand } from "../hermes/helper-process";

const ReadResultSchema = z.object({
  success: z.literal(true),
  values: z.record(z.string(), z.unknown()),
  env: z.record(z.string(), z.boolean()),
  revealed: z.record(z.string(), z.string()),
});
const WriteResultSchema = z.object({ success: z.boolean(), error: z.string().nullable() });

export type HermesSettingsSnapshot = {
  readonly values: Readonly<Record<string, unknown>>;
  readonly env: Readonly<Record<string, boolean>>;
  readonly revealed: Readonly<Record<string, string>>;
};

export type HermesSettingsChange = {
  readonly set?: Readonly<Record<string, string>>;
  readonly unset?: readonly string[];
  readonly env?: Readonly<Record<string, string>>;
  readonly envUnset?: readonly string[];
};

export class SettingRejectedError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "SettingRejectedError";
  }
}

export class HermesSettings {
  constructor(
    private readonly helper: HelperCommand,
    private readonly onCredentialsChanged: () => void,
  ) {}

  read(keys: readonly string[], env: readonly string[] = [], reveal: readonly string[] = []): Promise<HermesSettingsSnapshot> {
    return runHermesHelper(this.helper, "settings", { action: "read", keys, env, reveal }, ReadResultSchema);
  }

  async write(change: HermesSettingsChange): Promise<void> {
    const result = await runHermesHelper(
      this.helper,
      "settings",
      { action: "write", set: change.set ?? {}, unset: change.unset ?? [], env: change.env ?? {}, env_unset: change.envUnset ?? [] },
      WriteResultSchema,
    );
    if (!result.success) {
      throw new SettingRejectedError(result.error ?? "Hermes rejected the change");
    }
    if (Object.keys(change.env ?? {}).length > 0 || (change.envUnset ?? []).length > 0) {
      this.onCredentialsChanged();
    }
  }
}
