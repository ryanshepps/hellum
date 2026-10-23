import { z } from "zod";

export const HermesJobSchema = z.object({
  id: z.string(),
  name: z.string().nullable(),
  prompt: z.string().nullable(),
  schedule: z
    .object({
      kind: z.enum(["cron", "interval", "once"]),
      expr: z.string().nullish(),
      minutes: z.number().nullish(),
      run_at: z.string().nullish(),
      display: z.string().nullish(),
    })
    .nullable(),
  schedule_display: z.string().nullable(),
  enabled: z.boolean().nullable(),
  state: z.string().nullable(),
  next_run_at: z.string().nullable(),
  last_run_at: z.string().nullable(),
  last_status: z.string().nullable(),
  last_error: z.string().nullable(),
  created_at: z.string().nullable(),
  script: z.string().nullable(),
  no_agent: z.boolean().nullable(),
  deliver: z.string().nullable(),
});

export type HermesJob = z.infer<typeof HermesJobSchema>;

export type VellumSchedule = {
  readonly id: string;
  readonly name: string;
  readonly enabled: boolean;
  readonly syntax: "cron";
  readonly expression: string | null;
  readonly cronExpression: string | null;
  readonly timezone: string | null;
  readonly message: string;
  readonly script: string | null;
  readonly nextRunAt: number;
  readonly lastRunAt: number | null;
  readonly lastStatus: string | null;
  readonly retryCount: number;
  readonly maxRetries: number;
  readonly retryBackoffMs: number;
  readonly timeoutMs: number | null;
  readonly inferenceProfile: string | null;
  readonly groupId: string | null;
  readonly createdFromConversationId: string | null;
  readonly createdFromConversationExists: boolean;
  readonly createdFromConversationArchivedAt: number | null;
  readonly description: string;
  readonly cadenceDescription: string;
  readonly mode: "execute" | "script";
  readonly status: "active" | "fired" | "cancelled";
  readonly routingIntent: "single_channel";
  readonly quiet: boolean;
  readonly reuseConversation: boolean;
  readonly wakeConversationId: string | null;
  readonly workflowName: string | null;
  readonly sourceKey: string | null;
  readonly userEnabled: boolean | null;
  readonly disarmReason: string | null;
  readonly isOneShot: boolean;
  readonly isDeferred: boolean;
};

function toMs(iso: string | null | undefined): number | null {
  if (!iso) {
    return null;
  }
  const parsed = Date.parse(iso);
  return Number.isFinite(parsed) ? parsed : null;
}

export function intervalToCron(minutes: number): string | null {
  if (minutes > 0 && minutes < 60 && 60 % minutes === 0) {
    return `*/${minutes} * * * *`;
  }
  if (minutes >= 60 && minutes % 60 === 0) {
    const hours = minutes / 60;
    if (hours < 24 && 24 % hours === 0) {
      return hours === 1 ? "0 * * * *" : `0 */${hours} * * *`;
    }
    if (hours === 24) {
      return "0 0 * * *";
    }
  }
  return null;
}

function plural(count: number, unit: string): string {
  return count === 1 ? `every ${unit}` : `every ${count} ${unit}s`;
}

export function describeCadence(job: Pick<HermesJob, "schedule" | "schedule_display">): string {
  const schedule = job.schedule;
  if (!schedule) {
    return job.schedule_display ?? "Unscheduled";
  }
  switch (schedule.kind) {
    case "interval": {
      const minutes = schedule.minutes ?? 0;
      return minutes % 60 === 0 ? plural(minutes / 60, "hour") : plural(minutes, "minute");
    }
    case "once": {
      const at = toMs(schedule.run_at);
      return at === null ? "Once" : `Once at ${new Date(at).toISOString().replace("T", " ").slice(0, 16)} UTC`;
    }
    case "cron":
      return schedule.expr ?? schedule.display ?? job.schedule_display ?? "Cron";
    default: {
      const exhaustive: never = schedule.kind;
      return exhaustive;
    }
  }
}

function cronExpressionOf(job: HermesJob): string | null {
  const schedule = job.schedule;
  if (schedule?.kind === "cron") {
    return schedule.expr ?? null;
  }
  return schedule?.kind === "interval" && schedule.minutes ? intervalToCron(schedule.minutes) : null;
}

function statusOf(job: HermesJob): VellumSchedule["status"] {
  if (job.state === "completed" || (job.schedule?.kind === "once" && job.last_run_at && !job.next_run_at)) {
    return "fired";
  }
  return "active";
}

export function toVellumSchedule(job: HermesJob, description: string, timezone: string | null): VellumSchedule {
  const cronExpression = cronExpressionOf(job);
  const enabled = job.enabled ?? true;
  return {
    id: job.id,
    name: job.name ?? job.prompt?.slice(0, 50) ?? job.id,
    enabled,
    syntax: "cron",
    expression: cronExpression ?? job.schedule_display ?? null,
    cronExpression,
    timezone,
    message: job.prompt ?? "",
    script: job.script ?? null,
    nextRunAt: toMs(job.next_run_at) ?? 0,
    lastRunAt: toMs(job.last_run_at),
    lastStatus: job.last_status ?? null,
    retryCount: 0,
    maxRetries: 0,
    retryBackoffMs: 0,
    timeoutMs: null,
    inferenceProfile: null,
    groupId: null,
    createdFromConversationId: null,
    createdFromConversationExists: false,
    createdFromConversationArchivedAt: null,
    description,
    cadenceDescription: describeCadence(job),
    mode: job.no_agent ? "script" : "execute",
    status: statusOf(job),
    routingIntent: "single_channel",
    quiet: false,
    reuseConversation: false,
    wakeConversationId: null,
    workflowName: null,
    sourceKey: null,
    userEnabled: enabled,
    disarmReason: null,
    isOneShot: job.schedule?.kind === "once",
    isDeferred: false,
  };
}

export type HermesJobRun = {
  readonly id: string;
  readonly finished_at: string;
  readonly output: string;
};

export type CronSession = {
  readonly id: string;
  readonly title: string;
  readonly startedAtMs: number;
};

export type VellumScheduleRun = {
  readonly id: string;
  readonly jobId: string;
  readonly status: "ok" | "error";
  readonly startedAt: number;
  readonly finishedAt: number;
  readonly durationMs: number | null;
  readonly output: string;
  readonly error: string | null;
  readonly conversationId: string | null;
  readonly conversationExists: boolean;
  readonly conversationArchivedAt: null;
  readonly conversations: readonly { id: string; title: string; exists: true; archivedAt: null }[];
  readonly estimatedCostUsd: number;
  readonly createdAt: number;
};

export function cronSessionsForJob(jobId: string, sessions: readonly CronSession[]): readonly CronSession[] {
  return sessions.filter((session) => session.id.startsWith(`cron_${jobId}_`)).toSorted((a, b) => b.startedAtMs - a.startedAtMs);
}

type RunReport = { readonly failed: boolean; readonly response: string; readonly error: string | null };

function section(markdown: string, heading: string): string | null {
  const start = markdown.indexOf(`\n## ${heading}\n`);
  if (start === -1) {
    return null;
  }
  const body = markdown.slice(start + heading.length + 5);
  const end = body.indexOf("\n## ");
  return (end === -1 ? body : body.slice(0, end)).trim();
}

export function parseRunReport(markdown: string): RunReport {
  const failed = /^# .*\(FAILED\)\s*$/m.test(markdown.split("\n", 1)[0] ?? "");
  const error = section(markdown, "Error")?.replace(/^```\n?|\n?```$/g, "").trim() ?? null;
  return { failed, response: section(markdown, "Response") ?? markdown.trim(), error: failed ? error : null };
}

export function toVellumScheduleRuns(jobId: string, runs: readonly HermesJobRun[], sessions: readonly CronSession[]): readonly VellumScheduleRun[] {
  const jobSessions = cronSessionsForJob(jobId, sessions);
  return runs.flatMap((run) => {
    const finishedAt = toMs(run.finished_at);
    if (finishedAt === null) {
      return [];
    }
    const session = jobSessions.find((candidate) => candidate.startedAtMs <= finishedAt);
    const startedAt = session?.startedAtMs ?? finishedAt;
    const report = parseRunReport(run.output);
    return [
      {
        id: `${jobId}:${run.id}`,
        jobId,
        status: report.failed ? "error" : "ok",
        startedAt,
        finishedAt,
        durationMs: session ? finishedAt - startedAt : null,
        output: report.failed ? "" : report.response,
        error: report.error,
        conversationId: session?.id ?? null,
        conversationExists: session !== undefined,
        conversationArchivedAt: null,
        conversations: session ? [{ id: session.id, title: session.title, exists: true, archivedAt: null }] : [],
        estimatedCostUsd: 0,
        createdAt: finishedAt,
      },
    ];
  });
}
