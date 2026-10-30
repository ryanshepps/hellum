import type { SettingsSection } from "./settings-service";
import { timezoneSection } from "./timezone";

export const SETTINGS_SECTIONS: readonly SettingsSection[] = [timezoneSection];
