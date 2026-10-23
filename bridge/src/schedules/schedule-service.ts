import { z } from "zod";
import { runHermesHelper, type HelperCommand } from "../hermes/helper-process";
import type { SessionRow } from "../hermes/schemas";
import type { JsonFile } from "../storage/json-file";
import { HermesJobSchema, toVellumSchedule, toVellumScheduleRuns, type VellumSchedule, type VellumScheduleRun } from "../translate/schedules";

const ListResultSchema = z.object({ success: z.literal(true), timezone: z.string().nullable(), jobs: z.array(HermesJobSchema) });
const RunsResultSchema = z.object({
  success: z.literal(true),
  runs: z.array(z.object({ id: z.string(), finished_at: z.string(), output: z.string() })),
});
const WriteResultSchema = z.object({ success: z.boolean(), job_id: z.string().optional(), error: z.string().optional() }).passthrough();

export const ScheduleDescriptionsSchema = z.record(z.string(), z.string());
export type ScheduleDescriptions = z.infer<typeof ScheduleDescriptionsSchema>;

export class ScheduleNotFoundError extends Error {
  constructor(id: string) {
    super(`No schedule ${id}`);
    this.name = "ScheduleNotFoundError";
  }
}

export class ScheduleRejectedError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "ScheduleRejectedError";
  }
}

export type NewSchedule = {
  readonly name: string;
  readonly description: string;
  readonly expression: string;
  readonly message: string;
  readonly enabled: boolean;
};

export type ScheduleChanges = {
  readonly name?: string | undefined;
  readonly expression?: string | undefined;
  readonly message?: string | undefined;
};

export class ScheduleService {
  constructor(
    private readonly helper: HelperCommand,
    private readonly descriptions: JsonFile<ScheduleDescriptions>,
    private readonly sessionRows: () => Promise<readonly SessionRow[]>,
    private readonly fallbackTimezone: string,
  ) {}

  async list(): Promise<readonly VellumSchedule[]> {
    const [result, descriptions] = await Promise.all([
      runHermesHelper(this.helper, "cron", { action: "list" }, ListResultSchema),
      this.descriptions.read(),
    ]);
    const timezone = result.timezone ?? this.fallbackTimezone;
    return result.jobs.map((job) => toVellumSchedule(job, descriptions[job.id] ?? "", timezone));
  }

  async get(id: string): Promise<VellumSchedule> {
    const schedule = (await this.list()).find((candidate) => candidate.id === id);
    if (!schedule) {
      throw new ScheduleNotFoundError(id);
    }
    return schedule;
  }

  async create(schedule: NewSchedule): Promise<VellumSchedule> {
    const result = await this.write({ action: "create", name: schedule.name, schedule: schedule.expression, prompt: schedule.message });
    if (!result.job_id) {
      throw new ScheduleRejectedError("Hermes did not return a job id");
    }
    if (schedule.description) {
      await this.descriptions.write({ ...(await this.descriptions.read()), [result.job_id]: schedule.description });
    }
    if (!schedule.enabled) {
      await this.write({ action: "pause", job_id: result.job_id });
    }
    return this.get(result.job_id);
  }

  async update(id: string, changes: ScheduleChanges): Promise<void> {
    await this.get(id);
    await this.write({ action: "update", job_id: id, name: changes.name, schedule: changes.expression, prompt: changes.message });
  }

  async setEnabled(id: string, enabled: boolean): Promise<void> {
    await this.get(id);
    await this.write({ action: enabled ? "resume" : "pause", job_id: id });
  }

  async runNow(id: string): Promise<void> {
    await this.get(id);
    await this.write({ action: "run", job_id: id });
  }

  async remove(id: string): Promise<void> {
    await this.get(id);
    await this.write({ action: "remove", job_id: id });
    const { [id]: _removed, ...rest } = await this.descriptions.read();
    await this.descriptions.write(rest);
  }

  async runs(id: string, limit: number, before: number | null): Promise<{ runs: readonly VellumScheduleRun[]; nextCursor: number | null }> {
    await this.get(id);
    const [result, rows] = await Promise.all([
      runHermesHelper(this.helper, "cron", { action: "runs", job_id: id, limit: 200 }, RunsResultSchema),
      this.sessionRows(),
    ]);
    const sessions = rows.map((row) => ({ id: row.id, title: row.title, startedAtMs: Math.round(row.started_at * 1000) }));
    const older = toVellumScheduleRuns(id, result.runs, sessions).filter((run) => before === null || run.startedAt < before);
    const page = older.slice(0, limit);
    const last = page.at(-1);
    return { runs: page, nextCursor: older.length > limit && last ? last.startedAt : null };
  }

  private async write(request: object): Promise<z.infer<typeof WriteResultSchema>> {
    const result = await runHermesHelper(this.helper, "cron", request, WriteResultSchema);
    if (!result.success) {
      throw new ScheduleRejectedError(result.error ?? "Hermes rejected the schedule change");
    }
    return result;
  }
}
