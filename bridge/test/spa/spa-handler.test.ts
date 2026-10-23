import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildRemoteGatewayConfig } from "../../src/spa/index-html";
import { createSpaHandler } from "../../src/spa/spa-handler";

let dir: string | null = null;

afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
  dir = null;
});

describe("createSpaHandler", () => {
  test("serves a rebuilt index without a bridge restart", async () => {
    dir = await mkdtemp(join(tmpdir(), "hellum-spa-"));
    const index = join(dir, "index.html");
    await writeFile(index, '<head></head><script src="/assistant/assets/app-old.js"></script>');
    const spa = createSpaHandler(dir, buildRemoteGatewayConfig("Hellum", "hellum"));
    const request = () => new Request("http://bridge/assistant/");

    expect(await (await spa(request()))?.text()).toContain("app-old.js");

    await writeFile(index, '<head></head><script src="/assistant/assets/app-new.js"></script>');
    const later = new Date(Date.now() + 5_000);
    await utimes(index, later, later);
    expect(await (await spa(request()))?.text()).toContain("app-new.js");
  });
});
