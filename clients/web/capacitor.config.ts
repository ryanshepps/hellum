import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { CapacitorConfig } from "@capacitor/cli";
import { KeyboardResize, KeyboardStyle } from "@capacitor/keyboard";

const LOCAL_XCCONFIG = join(__dirname, "../ios/App/App/Config/Local.xcconfig");

function bundleId(): string {
  const local = existsSync(LOCAL_XCCONFIG) ? readFileSync(LOCAL_XCCONFIG, "utf8") : "";
  return /^HELLUM_BUNDLE_ID\s*=\s*(\S+)/m.exec(local)?.[1] ?? "com.example.hellum";
}

const config: CapacitorConfig = {
  appId: bundleId(),
  appName: "Hellum",
  webDir: "capacitor-shell",
  ios: {
    path: "../ios",
    contentInset: "never",
    scheme: "App",
  },
  android: {
    path: "../android",
  },
  plugins: {
    LocalNotifications: {
      smallIcon: "ic_stat_notification",
      iconColor: "#F6C744",
    },
    Keyboard: {
      resize: KeyboardResize.Native,
      style: KeyboardStyle.Default,
      autoBackdropColor: "dom",
    },
  },
};

export default config;
