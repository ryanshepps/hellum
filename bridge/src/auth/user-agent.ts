import type { Platform } from "./devices";

export type DescribedDevice = {
  readonly platform: Platform;
  readonly name: string;
};

const RULES: ReadonlyArray<readonly [RegExp, DescribedDevice]> = [
  [/\biPad\b/, { platform: "ios", name: "iPad" }],
  [/\biPhone\b/, { platform: "ios", name: "iPhone" }],
  [/\bAndroid\b/, { platform: "android", name: "Android device" }],
  [/\bMacintosh\b/, { platform: "desktop", name: "Mac browser" }],
  [/\bWindows\b/, { platform: "desktop", name: "Windows browser" }],
  [/\bLinux\b/, { platform: "desktop", name: "Linux browser" }],
];

export function describeUserAgent(userAgent: string | null): DescribedDevice {
  const match = userAgent ? RULES.find(([pattern]) => pattern.test(userAgent)) : undefined;
  return match?.[1] ?? { platform: "desktop", name: "Unknown device" };
}
