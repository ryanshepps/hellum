import { afterEach, describe, expect, test } from "bun:test";
import { enumViolations, missingFields, responseSchema, variantFor } from "../support/daemon-spec";
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

type Skill = { id: string; kind: string; status: string; category: string };
type SkillList = { skills: Skill[]; categoryCounts: Record<string, number>; totalCount: number };

async function ids(api: Awaited<ReturnType<typeof start>>, query: string): Promise<string[]> {
  return ((await (await api.get(`skills${query}`)).json()) as SkillList).skills.map((skill) => skill.id);
}

describe("skills", () => {
  test.each([
    ["", ["himalaya", "plan"]],
    ["?include=catalog", ["himalaya", "plan", "arxiv", "pinned"]],
    ["?include=catalog&kind=available", ["arxiv", "pinned"]],
    ["?include=catalog&kind=installed", ["himalaya", "plan"]],
    ["?include=catalog&q=ARXIV", ["arxiv"]],
    ["?include=catalog&category=research", ["arxiv", "pinned"]],
  ])("listing skills%s", async (query, expected) => {
    const api = await start();
    expect(await ids(api, query)).toEqual(expected);
  });

  test("category counts ignore the category filter so every tab keeps its badge", async () => {
    const api = await start();
    const list = (await (await api.get("skills?include=catalog&category=email")).json()) as SkillList;
    expect(list.categoryCounts).toEqual({ "software-development": 1, email: 1, research: 2 });
    expect(list.totalCount).toBe(4);
  });

  test("skills match the web client's schema", async () => {
    const api = await start();
    const list = (await (await api.get("skills?include=catalog")).json()) as { skills: Record<string, unknown>[] };
    const itemSchema = responseSchema("skills", "get").properties?.skills?.items ?? {};
    const problems = list.skills.flatMap((skill) => {
      const variant = variantFor(itemSchema, skill);
      return [...missingFields(skill, variant), ...enumViolations(skill, variant)];
    });
    expect(problems).toEqual([]);
  });

  test("installing a catalog skill restores it and removing archives it again", async () => {
    const api = await start();
    expect(await (await api.send("POST", "skills/install", { slug: "arxiv" })).json()).toEqual({ ok: true, skillId: "arxiv" });
    expect(await ids(api, "")).toContain("arxiv");

    expect((await api.send("DELETE", "skills/arxiv")).status).toBe(200);
    expect(await ids(api, "")).not.toContain("arxiv");
  });

  test("Hermes refusing an install is reported to the client", async () => {
    const api = await start();
    const response = await api.send("POST", "skills/install", { slug: "pinned" });
    expect(response.status).toBe(422);
    expect(await response.text()).toContain("hub-installed");
  });

  test("a skill's files are browsable", async () => {
    const api = await start();
    const files = (await (await api.get("skills/plan/files")).json()) as { skill: Skill; files: Record<string, unknown>[] };
    expect(files.skill.id).toBe("plan");
    expect(files.files.map((file) => file.path)).toEqual(["SKILL.md"]);
    const content = (await (await api.get("skills/plan/files/content?path=SKILL.md")).json()) as Record<string, unknown>;
    expect(content).toMatchObject({ name: "SKILL.md", isBinary: false });
    expect(missingFields(content, responseSchema("skills/{id}/files/content", "get"))).toEqual([]);
  });

  test.each(["skills/nope", "skills/nope/files", "skills/plan/files/content?path=../../config.yaml"])("%s is not found", async (path) => {
    const api = await start();
    expect((await api.get(path)).status).toBe(404);
  });
});
