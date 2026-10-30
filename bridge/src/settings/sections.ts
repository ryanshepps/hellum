import type { SettingsSection } from "./settings-service";
import { timezoneSection } from "./timezone";
import { webSection } from "./web";

export const SETTINGS_SECTIONS: readonly SettingsSection[] = [timezoneSection, webSection];
