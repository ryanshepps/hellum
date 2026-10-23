import { z } from "zod";

export const HermesSkillSchema = z.object({
  name: z.string(),
  description: z.string(),
  category: z.string(),
  provenance: z.enum(["bundled", "hub", "local"]),
  state: z.enum(["enabled", "disabled", "archived"]),
});
export type HermesSkill = z.infer<typeof HermesSkillSchema>;

export const HermesSkillFileSchema = z.object({
  path: z.string(),
  name: z.string(),
  size: z.number(),
  mime_type: z.string(),
  is_binary: z.boolean(),
  content: z.string().nullable(),
});
export type HermesSkillFile = z.infer<typeof HermesSkillFileSchema>;

export type VellumSkill = {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly kind: "installed" | "catalog";
  readonly status: "enabled" | "available";
  readonly category: string;
  readonly origin: "custom";
  readonly slug: string;
};

export type VellumSkillFile = {
  readonly path: string;
  readonly name: string;
  readonly size: number;
  readonly mimeType: string;
  readonly isBinary: boolean;
  readonly content: string | null;
};

export type SkillCategory = {
  readonly slug: string;
  readonly label: string;
  readonly description: string;
  readonly icon: string;
};

export type SkillQuery = {
  readonly includeCatalog: boolean;
  readonly kind: string | null;
  readonly origin: string | null;
  readonly search: string | null;
  readonly category: string | null;
};

const CATEGORY_ICONS: Readonly<Record<string, string>> = {
  email: "mail",
  "social-media": "message-circle",
  "note-taking": "zap",
  productivity: "calendar",
  research: "globe",
  "software-development": "code",
  github: "code",
  mlops: "settings",
  "data-science": "settings",
  "autonomous-ai-agents": "zap",
  creative: "palette",
  media: "mic",
  "smart-home": "settings",
  apple: "settings",
};

function titleCase(slug: string): string {
  return slug
    .split("-")
    .map((word) => (word.length <= 2 ? word.toUpperCase() : `${word[0]?.toUpperCase() ?? ""}${word.slice(1)}`))
    .join(" ");
}

export function toVellumSkill(skill: HermesSkill): VellumSkill {
  const active = skill.state === "enabled";
  return {
    id: skill.name,
    name: skill.name,
    description: skill.description,
    kind: active ? "installed" : "catalog",
    status: active ? "enabled" : "available",
    category: skill.category,
    origin: "custom",
    slug: skill.name,
  };
}

function matchesKind(skill: VellumSkill, kind: string | null): boolean {
  if (kind === "installed") {
    return skill.kind === "installed";
  }
  if (kind === "available") {
    return skill.kind === "catalog";
  }
  return true;
}

function matchesSearch(skill: VellumSkill, search: string | null): boolean {
  const needle = search?.trim().toLowerCase();
  return !needle || `${skill.name} ${skill.description}`.toLowerCase().includes(needle);
}

export function selectSkills(skills: readonly HermesSkill[], query: SkillQuery) {
  const candidates = skills
    .map(toVellumSkill)
    .filter((skill) => query.includeCatalog || skill.kind !== "catalog")
    .filter((skill) => matchesKind(skill, query.kind))
    .filter((skill) => query.origin === null || skill.origin === query.origin)
    .filter((skill) => matchesSearch(skill, query.search))
    .toSorted((a, b) => Number(a.kind === "catalog") - Number(b.kind === "catalog") || a.name.localeCompare(b.name));
  const categoryCounts: Record<string, number> = {};
  for (const skill of candidates) {
    categoryCounts[skill.category] = (categoryCounts[skill.category] ?? 0) + 1;
  }
  const selected = query.category === null ? candidates : candidates.filter((skill) => skill.category === query.category);
  return { skills: selected, categoryCounts, totalCount: candidates.length };
}

export function skillCategories(skills: readonly HermesSkill[]): readonly SkillCategory[] {
  return [...new Set(skills.map((skill) => skill.category))].toSorted().map((slug) => ({
    slug,
    label: titleCase(slug),
    description: "",
    icon: CATEGORY_ICONS[slug] ?? "zap",
  }));
}

export function toVellumSkillFile(file: HermesSkillFile): VellumSkillFile {
  return { path: file.path, name: file.name, size: file.size, mimeType: file.mime_type, isBinary: file.is_binary, content: file.content };
}
