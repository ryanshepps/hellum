import { z } from "zod";
import { runHermesHelper, type HelperCommand } from "../hermes/helper-process";
import {
  HermesSkillFileSchema,
  HermesSkillSchema,
  selectSkills,
  skillCategories,
  toVellumSkill,
  toVellumSkillFile,
  type SkillCategory,
  type SkillQuery,
  type VellumSkill,
  type VellumSkillFile,
} from "../translate/skills";

const ListResultSchema = z.object({ success: z.literal(true), skills: z.array(HermesSkillSchema) });
const FilesResultSchema = z.union([
  z.object({ success: z.literal(true), files: z.array(HermesSkillFileSchema) }),
  z.object({ success: z.literal(false), error: z.string() }),
]);
const FileResultSchema = z.union([
  HermesSkillFileSchema.extend({ success: z.literal(true) }),
  z.object({ success: z.literal(false), error: z.string() }),
]);
const WriteResultSchema = z.object({ success: z.boolean(), error: z.string().nullable() });

export class SkillNotFoundError extends Error {
  constructor(id: string) {
    super(`No skill ${id}`);
    this.name = "SkillNotFoundError";
  }
}

export class SkillRejectedError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "SkillRejectedError";
  }
}

export class SkillService {
  constructor(private readonly helper: HelperCommand) {}

  async list(query: SkillQuery) {
    return selectSkills(await this.hermesSkills(), query);
  }

  async categories(): Promise<readonly SkillCategory[]> {
    return skillCategories(await this.hermesSkills());
  }

  async get(id: string): Promise<VellumSkill> {
    const skill = (await this.hermesSkills()).find((candidate) => candidate.name === id);
    if (!skill) {
      throw new SkillNotFoundError(id);
    }
    return toVellumSkill(skill);
  }

  async files(id: string): Promise<{ skill: VellumSkill; files: readonly VellumSkillFile[] }> {
    const [skill, result] = await Promise.all([this.get(id), runHermesHelper(this.helper, "skills", { action: "files", name: id }, FilesResultSchema)]);
    if (!result.success) {
      throw new SkillNotFoundError(id);
    }
    return { skill, files: result.files.map(toVellumSkillFile) };
  }

  async file(id: string, path: string): Promise<VellumSkillFile> {
    const result = await runHermesHelper(this.helper, "skills", { action: "file", name: id, path }, FileResultSchema);
    if (!result.success) {
      throw new SkillNotFoundError(`${id}/${path}`);
    }
    return toVellumSkillFile(result);
  }

  async install(id: string): Promise<void> {
    await this.get(id);
    await this.write({ action: "restore", name: id });
  }

  async remove(id: string): Promise<void> {
    await this.get(id);
    await this.write({ action: "remove", name: id });
  }

  private async hermesSkills() {
    return (await runHermesHelper(this.helper, "skills", { action: "list" }, ListResultSchema)).skills;
  }

  private async write(request: object): Promise<void> {
    const result = await runHermesHelper(this.helper, "skills", request, WriteResultSchema);
    if (!result.success) {
      throw new SkillRejectedError(result.error ?? "Hermes rejected the skill change");
    }
  }
}
