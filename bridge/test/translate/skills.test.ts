import { describe, expect, test } from "bun:test";
import { skillCategories, toVellumSkill, type HermesSkill } from "../../src/translate/skills";

const base: HermesSkill = { name: "plan", description: "d", category: "software-development", provenance: "bundled", state: "enabled" };

describe("toVellumSkill", () => {
  test.each([
    ["enabled", "installed", "enabled"],
    ["disabled", "catalog", "available"],
    ["archived", "catalog", "available"],
  ] as const)("a %s Hermes skill is %s and %s", (state, kind, status) => {
    expect(toVellumSkill({ ...base, state })).toMatchObject({ kind, status });
  });
});

describe("skillCategories", () => {
  test("categories are unique, sorted and labelled", () => {
    const categories = skillCategories([base, { ...base, name: "x", category: "autonomous-ai-agents" }, { ...base, name: "y" }]);
    expect(categories.map((category) => [category.slug, category.label])).toEqual([
      ["autonomous-ai-agents", "Autonomous AI Agents"],
      ["software-development", "Software Development"],
    ]);
  });
});
