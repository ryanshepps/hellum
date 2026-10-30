import { afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { readMcpServers } from "../support/fake-hermes-mcp";
import { authedClient, pairDevice, startTestBridge, type TestBridge } from "../support/test-bridge";

let bridge: TestBridge | null = null;

afterEach(async () => {
  await bridge?.dispose();
  bridge = null;
});

async function start() {
  bridge = await startTestBridge();
  return authedClient(bridge, await pairDevice(bridge));
}

const SERVER = { name: "exa", transportType: "streamable-http", url: "https://mcp.exa.ai/mcp", headers: { Authorization: "Bearer secret" } };

describe("MCP servers", () => {
  test("an added server lands in Hermes' config and lists without its credentials", async () => {
    const api = await start();
    expect((await api.send("POST", "internal/mcp/add", SERVER)).status).toBe(200);
    expect(readMcpServers(join(bridge?.stateDir ?? "", "fake-mcp.json")).exa?.url).toBe(SERVER.url);
    const listed = await (await api.get("internal/mcp/list")).text();
    expect(listed).not.toContain("secret");
    expect(JSON.parse(listed).servers[0]).toMatchObject({ id: "exa", status: "connected", authType: "bearer", hasStaticAuth: true, transport: { type: "streamable-http" } });
  });

  test("the tools summary counts what each server offers", async () => {
    const api = await start();
    await api.send("POST", "internal/mcp/add", SERVER);
    expect(await (await api.get("internal/mcp/tools-summary")).json()).toMatchObject({ totalToolCount: 1, servers: [{ serverId: "exa", toolCount: 1 }] });
  });

  test("a removed server is gone from Hermes", async () => {
    const api = await start();
    await api.send("POST", "internal/mcp/add", SERVER);
    await api.send("POST", "internal/mcp/remove", { name: "exa" });
    expect(((await (await api.get("internal/mcp/list")).json()) as { servers: unknown[] }).servers).toEqual([]);
  });

  test("adding a name that exists is refused", async () => {
    const api = await start();
    await api.send("POST", "internal/mcp/add", SERVER);
    expect((await api.send("POST", "internal/mcp/add", SERVER)).status).toBe(422);
  });

  test("the page loads with no OAuth or plugin catalog behind it", async () => {
    const api = await start();
    expect(await (await api.get("oauth/providers")).json()).toEqual({ providers: [] });
    expect(await (await api.get("plugins")).json()).toEqual({ plugins: [] });
    expect((await api.get("plugins/search?q=x")).status).toBe(200);
  });
});
