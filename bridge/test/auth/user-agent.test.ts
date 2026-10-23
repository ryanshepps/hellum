import { describe, expect, test } from "bun:test";
import { describeUserAgent, type DescribedDevice } from "../../src/auth/user-agent";

const cases: ReadonlyArray<readonly [string | null, DescribedDevice]> = [
  ["Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15", { platform: "ios", name: "iPhone" }],
  ["Mozilla/5.0 (iPad; CPU OS 18_6 like Mac OS X) AppleWebKit/605.1.15", { platform: "ios", name: "iPad" }],
  ["Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36", { platform: "android", name: "Android device" }],
  ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36", { platform: "desktop", name: "Mac browser" }],
  ["curl/8.7.1", { platform: "desktop", name: "Unknown device" }],
  [null, { platform: "desktop", name: "Unknown device" }],
];

describe("describeUserAgent", () => {
  for (const [userAgent, expected] of cases) {
    test(String(userAgent).slice(0, 40), () => {
      expect(describeUserAgent(userAgent)).toEqual(expected);
    });
  }
});
