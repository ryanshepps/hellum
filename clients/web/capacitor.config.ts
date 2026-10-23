import type { CapacitorConfig } from "@capacitor/cli";
import { KeyboardResize, KeyboardStyle } from "@capacitor/keyboard";

const config: CapacitorConfig = {
  appId: "com.ryanshepps.hellum",
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
