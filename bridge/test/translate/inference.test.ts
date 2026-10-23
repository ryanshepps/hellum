import { describe, expect, test } from "bun:test";
import { activeProfileName, applyLlmPatch, hermesSlugForSecretName, withHermesProfile, type ProfileStore } from "../../src/translate/inference";

const current = { model: "@preset/vellum-main", provider: "openrouter" };

describe("withHermesProfile", () => {
  test("seeds a profile for Hermes' model when none matches", () => {
    const seeded = withHermesProfile({ profiles: {}, profileOrder: [] }, current);
    expect(seeded).toEqual({
      profiles: { hermes: { label: "@preset/vellum-main", provider: "openrouter", provider_connection: "openrouter", model: "@preset/vellum-main" } },
      profileOrder: ["hermes"],
    });
  });

  test("leaves the store alone when a profile already matches", () => {
    const store: ProfileStore = { profiles: { main: { provider: "openrouter", model: "@preset/vellum-main" } }, profileOrder: ["main"] };
    expect(withHermesProfile(store, current)).toBe(store);
    expect(activeProfileName(store, current)).toBe("main");
  });

  test("picks a free name when 'hermes' is taken by another model", () => {
    const store: ProfileStore = { profiles: { hermes: { provider: "anthropic", model: "claude" } }, profileOrder: ["hermes"] };
    expect(withHermesProfile(store, current).profileOrder).toEqual(["hermes-2", "hermes"]);
  });
});

describe("applyLlmPatch", () => {
  test("merges fields, deletes nulls and drops deleted names from the order", () => {
    const store: ProfileStore = { profiles: { a: { label: "A", model: "m1" }, b: { model: "m2" } }, profileOrder: ["a", "b"] };
    expect(applyLlmPatch(store, { profiles: { a: { model: "m3" }, b: null } })).toEqual({ profiles: { a: { label: "A", model: "m3" } }, profileOrder: ["a"] });
  });
});

describe("hermesSlugForSecretName", () => {
  test.each([
    ["openrouter:api_key", "openrouter"],
    ["openai", "openai-api"],
    ["elevenlabs:api_key", null],
  ])("%s → %p", (name, slug) => {
    expect(hermesSlugForSecretName(name)).toBe(slug);
  });
});
