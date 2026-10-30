import { z } from "zod";
import { SettingRejectedError } from "./hermes-settings";
import type { SettingsSection } from "./settings-service";

const TimezonePatchSchema = z.object({ ui: z.object({ userTimezone: z.string() }) });

function isTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

export const timezoneSection: SettingsSection = {
  keys: ["timezone"],
  view: ({ values }) => (typeof values.timezone === "string" && values.timezone ? { ui: { userTimezone: values.timezone } } : {}),
  change: (patch) => {
    const parsed = TimezonePatchSchema.safeParse(patch);
    if (!parsed.success) {
      return null;
    }
    const zone = parsed.data.ui.userTimezone.trim();
    if (!zone) {
      return { unset: ["timezone"] };
    }
    if (!isTimeZone(zone)) {
      throw new SettingRejectedError(`${zone} is not a time zone`);
    }
    return { set: { timezone: zone } };
  },
};
