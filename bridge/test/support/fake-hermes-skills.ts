import { existsSync, readFileSync, writeFileSync } from "node:fs";

type Skill = { name: string; description: string; category: string; provenance: "bundled" | "hub" | "local"; state: "enabled" | "disabled" | "archived" };

export type SkillsRequest = { action: string; name?: string; path?: string };

const SEED: Skill[] = [
  { name: "plan", description: "Write a plan first", category: "software-development", provenance: "bundled", state: "enabled" },
  { name: "himalaya", description: "Email from the terminal", category: "email", provenance: "bundled", state: "disabled" },
  { name: "arxiv", description: "Search arXiv papers", category: "research", provenance: "bundled", state: "archived" },
  { name: "pinned", description: "From the hub", category: "research", provenance: "hub", state: "archived" },
];

const SKILL_MD = (skill: Skill) => `---\nname: ${skill.name}\n---\n# ${skill.name}\n\n${skill.description}\n`;

function fileView(skill: Skill) {
  const content = SKILL_MD(skill);
  return { path: "SKILL.md", name: "SKILL.md", size: content.length, mime_type: "text/markdown", is_binary: false, content };
}

export function handleSkills(request: SkillsRequest): object {
  const stateFile = process.env.FAKE_HERMES_SKILLS_FILE ?? "";
  const skills: Skill[] = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, "utf8")) : SEED;
  const save = () => writeFileSync(stateFile, JSON.stringify(skills));
  const skill = skills.find((candidate) => candidate.name === request.name);
  switch (request.action) {
    case "list":
      return { success: true, skills };
    case "files":
      return skill ? { success: true, files: [fileView(skill)] } : { success: false, error: "not_found" };
    case "file":
      return skill && request.path === "SKILL.md" ? { success: true, ...fileView(skill) } : { success: false, error: "not_found" };
    case "install":
      if (!skill || skill.state === "enabled") {
        return { success: false, error: `skill '${request.name}' not found` };
      }
      if (skill.state === "archived" && skill.provenance === "hub") {
        return { success: false, error: `skill '${request.name}' is now hub-installed; restore would shadow the upstream version` };
      }
      skill.state = "enabled";
      save();
      return { success: true, error: null };
    case "remove":
      if (skill) {
        skill.state = "disabled";
        save();
      }
      return { success: true, error: null };
    default:
      return { success: false, error: `unknown action ${request.action}` };
  }
}
