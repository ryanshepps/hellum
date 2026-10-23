import { describe, expect, test } from "bun:test";
import { buildRemoteGatewayConfig, injectConfig } from "../../src/spa/index-html";

const config = buildRemoteGatewayConfig("Hellum", "hellum");
const expectedScript =
  '<script>window.__VELLUM_CONFIG__={"mode":"remote-gateway","apiBaseUrl":"/v1","platformDisabled":true,"disablePlatform":true,"assistantName":"Hellum","assistantId":"hellum"}</script>';

describe("injectConfig", () => {
  test("places the config script before </head>", () => {
    expect(injectConfig("<html><head><title>x</title></head><body></body></html>", config)).toBe(
      `<html><head><title>x</title>${expectedScript}</head><body></body></html>`,
    );
  });

  test("prepends the script when the document has no head", () => {
    expect(injectConfig("<p>hi</p>", config)).toBe(`${expectedScript}<p>hi</p>`);
  });

  test("escapes markup in config values", () => {
    const hostile = buildRemoteGatewayConfig("</script><script>alert(1)</script>", "hellum");
    const html = injectConfig("<head></head>", hostile);
    expect(html).not.toContain("</script><script>alert(1)");
    expect(html).toContain("\\u003c/script\\u003e");
  });
});
