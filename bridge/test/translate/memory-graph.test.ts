import { describe, expect, test } from "bun:test";
import { findMemoryEntry, memoryEntryId, memoryGraph, memoryNodeDetail, type MemorySnapshot } from "../../src/translate/memory-graph";

const snapshot: MemorySnapshot = {
  user: ["Prefers metric units", "Lives in Toronto"],
  memory: ["The repo uses Bun for scripts and tests, never npm"],
  modifiedAtMs: { user: 1_792_000_000_000, memory: null },
};

describe("memoryGraph", () => {
  test("links each entry to the hub for its store", () => {
    const graph = memoryGraph(snapshot);
    expect(graph.nodes.map((node) => [node.id.split(":")[0], node.label])).toEqual([
      ["hub", "You"],
      ["user", "Prefers metric units"],
      ["user", "Lives in Toronto"],
      ["hub", "Hermes' notes"],
      ["memory", "The repo uses Bun for scripts and tests, never …"],
    ]);
    expect(graph.edges).toHaveLength(3);
    expect(graph.edges.every((edge) => edge.source.startsWith("hub:") && edge.kind === "link")).toBe(true);
    expect(graph.nodes.map((node) => node.kind)).toEqual(["capability", "concept", "concept", "capability", "concept"]);
    expect(graph.nodes[1]?.updatedAtMs).toBe(1_792_000_000_000);
    expect(graph.nodes[4]?.updatedAtMs).toBeUndefined();
  });

  test("an empty memory has no nodes", () => {
    expect(memoryGraph({ user: [], memory: [], modifiedAtMs: { user: null, memory: null } })).toEqual({ nodes: [], edges: [] });
  });

  test("entry ids are stable and distinguish the two stores", () => {
    expect(memoryEntryId("user", "x")).toBe(memoryEntryId("user", "x"));
    expect(memoryEntryId("user", "x")).not.toBe(memoryEntryId("memory", "x"));
  });
});

describe("memoryNodeDetail / findMemoryEntry", () => {
  test("an entry node shows its full text", () => {
    const id = memoryEntryId("memory", "The repo uses Bun for scripts and tests, never npm");
    expect(memoryNodeDetail(snapshot, id)).toEqual({ found: true, title: "The repo uses Bun for scripts and tests, never …", content: "The repo uses Bun for scripts and tests, never npm" });
    expect(findMemoryEntry(snapshot, id)).toEqual({ target: "memory", entry: "The repo uses Bun for scripts and tests, never npm" });
  });

  test("a hub lists its entries", () => {
    expect(memoryNodeDetail(snapshot, "hub:user")).toEqual({ found: true, title: "You", content: "- Prefers metric units\n- Lives in Toronto" });
  });

  test("an unknown node is not found", () => {
    expect(memoryNodeDetail(snapshot, "user:nope")).toEqual({ found: false });
  });
});
