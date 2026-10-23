import { describe, expect, test } from "bun:test";
import { resolveSpaRoute, type SpaRoute } from "../../src/spa/spa-route";

const cases: ReadonlyArray<readonly [string, SpaRoute]> = [
  ["/", { kind: "redirect", location: "/assistant/" }],
  ["/assistant", { kind: "redirect", location: "/assistant/" }],
  ["/assistant/", { kind: "index" }],
  ["/assistant/index.html", { kind: "index" }],
  ["/assistant/__config", { kind: "config" }],
  ["/assistant/conversations/abc", { kind: "index" }],
  ["/assistant/pair", { kind: "index" }],
  ["/assistant/assets/app-123.js", { kind: "file", relativePath: "assets/app-123.js" }],
  ["/assistant/favicon.svg", { kind: "file", relativePath: "favicon.svg" }],
  ["/assistant/fonts/a%20b.woff2", { kind: "file", relativePath: "fonts/a b.woff2" }],
  ["/assistant/../secret.txt", { kind: "not-spa" }],
  ["/assistant/%2e%2e/secret.txt", { kind: "not-spa" }],
  ["/assistant/assets/../../secret.txt", { kind: "not-spa" }],
  ["/v1/conversations", { kind: "not-spa" }],
  ["/healthz", { kind: "not-spa" }],
];

describe("resolveSpaRoute", () => {
  for (const [pathname, expected] of cases) {
    test(pathname, () => {
      expect(resolveSpaRoute(pathname)).toEqual(expected);
    });
  }
});
