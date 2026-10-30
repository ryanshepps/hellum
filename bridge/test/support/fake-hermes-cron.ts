import { existsSync, readFileSync, writeFileSync } from "node:fs";

type Job = {
  id: string;
  name: string;
  prompt: string;
  schedule: { kind: "cron"; expr: string; display: string };
  schedule_display: string;
  enabled: boolean;
  state: string;
  next_run_at: string;
  last_run_at: string | null;
  last_status: string | null;
  last_error: string | null;
  created_at: string;
  script: null;
  no_agent: boolean;
  deliver: string;
};

type Run = { id: string; finished_at: string; output: string };

type Store = { jobs: Job[]; runs: Record<string, Run[]>; nextId: number };

export type CronRequest = { action: string; job_id?: string; name?: string; schedule?: string; prompt?: string; limit?: number };

const CRON_FIELDS = /^(\S+\s+){4}\S+$/;
const NEXT_RUN = "2026-11-01T09:00:00+00:00";
const RUN_FINISHED = "2026-10-23T14:00:30+00:00";

export function handleCron(request: CronRequest): object {
  const stateFile = process.env.FAKE_HERMES_CRON_FILE ?? "";
  const store: Store = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, "utf8")) : { jobs: [], runs: {}, nextId: 1 };
  const save = () => writeFileSync(stateFile, JSON.stringify(store));
  const job = store.jobs.find((candidate) => candidate.id === request.job_id);
  switch (request.action) {
    case "list":
      return { success: true, timezone: "America/Toronto", jobs: store.jobs };
    case "runs":
      return { success: true, runs: (store.runs[request.job_id ?? ""] ?? []).slice(0, request.limit ?? 25) };
    case "create": {
      const expr = request.schedule ?? "";
      if (!CRON_FIELDS.test(expr)) {
        return { success: false, error: `Invalid schedule '${expr}'` };
      }
      const id = `job${store.nextId}`;
      store.nextId += 1;
      store.jobs.push({
        id,
        name: request.name ?? id,
        prompt: request.prompt ?? "",
        schedule: { kind: "cron", expr, display: expr },
        schedule_display: expr,
        enabled: true,
        state: "scheduled",
        next_run_at: NEXT_RUN,
        last_run_at: null,
        last_status: null,
        last_error: null,
        created_at: "2026-10-23T12:00:00+00:00",
        script: null,
        no_agent: false,
        deliver: "hellum",
      });
      save();
      return { success: true, job_id: id };
    }
    case "update":
      if (!job) {
        return { success: false, error: "Job not found" };
      }
      Object.assign(job, {
        ...(request.name ? { name: request.name } : {}),
        ...(request.prompt ? { prompt: request.prompt } : {}),
        ...(request.schedule ? { schedule: { kind: "cron", expr: request.schedule, display: request.schedule }, schedule_display: request.schedule } : {}),
      });
      save();
      return { success: true };
    case "pause":
    case "resume":
      if (!job) {
        return { success: false, error: "Job not found" };
      }
      job.enabled = request.action === "resume";
      job.state = job.enabled ? "scheduled" : "paused";
      save();
      return { success: true };
    case "run":
      if (!job) {
        return { success: false, error: "Job not found" };
      }
      job.last_run_at = RUN_FINISHED;
      job.last_status = "ok";
      store.runs[job.id] = [
        { id: "2026-10-23_14-00-30", finished_at: RUN_FINISHED, output: `# Cron Job: ${job.name}\n\n## Prompt\n\n${job.prompt}\n\n## Response\n\nDone: ${job.prompt}\n` },
        ...(store.runs[job.id] ?? []),
      ];
      save();
      return { success: true };
    case "remove":
      store.jobs = store.jobs.filter((candidate) => candidate !== job);
      save();
      return job ? { success: true } : { success: false, error: "Job not found" };
    default:
      return { success: false, error: `unknown action ${request.action}` };
  }
}
