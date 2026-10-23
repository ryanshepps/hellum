import { afterEach, describe, expect, test } from "bun:test";
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

type Graph = { supported: boolean; nodes: { id: string; label: string }[]; edges: unknown[] };

describe("memory", () => {
  test("an empty Hermes memory is a supported, empty graph", async () => {
    const api = await start();
    expect(await (await api.get("memory-graph")).json()).toMatchObject({ supported: true, nodes: [], edges: [] });
    expect(await (await api.get("memory/stats")).json()).toEqual({ concepts: 0, graph_supported: true, tier: "v3" });
  });

  test("remembering something adds it to what Hermes knows about the user", async () => {
    const api = await start();
    const remembered = await api.send("POST", "memory/remember", { content: "Prefers metric units" });
    expect(await remembered.json()).toMatchObject({ success: true });

    const graph = (await (await api.get("memory-graph")).json()) as Graph;
    expect(graph.nodes.map((node) => node.label)).toEqual(["You", "Prefers metric units"]);
    const entry = graph.nodes[1]?.id ?? "";
    expect(await (await api.get(`memory-graph-node?id=${encodeURIComponent(entry)}`)).json()).toEqual({
      found: true,
      title: "Prefers metric units",
      content: "Prefers metric units",
    });
    expect(((await (await api.get("memory/stats")).json()) as { concepts: number }).concepts).toBe(1);
  });

  test("a memory Hermes refuses is reported, not saved", async () => {
    const api = await start();
    const refused = await api.send("POST", "memory/remember", { content: "x".repeat(2000) });
    expect(refused.status).toBe(422);
    expect(((await (await api.get("memory-graph")).json()) as Graph).nodes).toEqual([]);
  });

  test("an empty memory is refused", async () => {
    const api = await start();
    expect((await api.send("POST", "memory/remember", { content: "  " })).status).toBe(400);
  });
});
