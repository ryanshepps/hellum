import { z } from "zod";
import { runHermesHelper, type HelperCommand } from "../hermes/helper-process";

const SessionSchema = z.object({
  id: z.string(),
  source: z.string(),
  model: z.string(),
  provider: z.string(),
  started_at: z.number(),
  input_tokens: z.number(),
  output_tokens: z.number(),
  cache_read_tokens: z.number(),
  cache_write_tokens: z.number(),
  cost_usd: z.number().nullable(),
  priced: z.boolean(),
});
type Session = z.infer<typeof SessionSchema>;

const SessionsResultSchema = z.object({ success: z.literal(true), sessions: z.array(SessionSchema) });

export type UsageRange = { readonly from: number; readonly to: number; readonly scheduleId: string | null };
export type UsageBuckets = UsageRange & { readonly granularity: "daily" | "hourly"; readonly timeZone: string };

const HOUR_MS = 3_600_000;
const SCHEDULED_SOURCE = "cron";
const CHAT_SOURCES: ReadonlySet<string> = new Set(["local", "hellum"]);
const CRON_SESSION = /^cron_([^_]+)_/;

type Totals = {
  readonly totalInputTokens: number;
  readonly totalOutputTokens: number;
  readonly totalCacheCreationTokens: number;
  readonly totalCacheReadTokens: number;
  readonly totalEstimatedCostUsd: number;
  readonly eventCount: number;
};

function totals(sessions: readonly Session[]): Totals {
  return {
    totalInputTokens: sessions.reduce((sum, session) => sum + session.input_tokens, 0),
    totalOutputTokens: sessions.reduce((sum, session) => sum + session.output_tokens, 0),
    totalCacheCreationTokens: sessions.reduce((sum, session) => sum + session.cache_write_tokens, 0),
    totalCacheReadTokens: sessions.reduce((sum, session) => sum + session.cache_read_tokens, 0),
    totalEstimatedCostUsd: sessions.reduce((sum, session) => sum + (session.cost_usd ?? 0), 0),
    eventCount: sessions.length,
  };
}

function scheduleOf(session: Session): string | null {
  return CRON_SESSION.exec(session.id)?.[1] ?? null;
}

function actionLabel(source: string): string {
  if (source === SCHEDULED_SOURCE) {
    return "Scheduled tasks";
  }
  return CHAT_SOURCES.has(source) ? "Chats" : source || "Other";
}

function groupOf(session: Session, groupBy: string): { readonly group: string; readonly groupKey: string | null } {
  switch (groupBy) {
    case "call_site":
      return { group: actionLabel(session.source), groupKey: session.source || null };
    case "provider":
    case "inference_profile":
      return { group: session.provider || "Unknown", groupKey: session.provider || null };
    case "schedule": {
      const schedule = scheduleOf(session);
      return { group: schedule ?? "Not scheduled", groupKey: schedule };
    }
    case "actor":
      return { group: "Hermes", groupKey: "hermes" };
    default:
      return { group: session.model || "Unknown", groupKey: session.model || null };
  }
}

function grouped(sessions: readonly Session[], groupBy: string) {
  const groups = new Map<string, Session[]>();
  for (const session of sessions) {
    const { group } = groupOf(session, groupBy);
    groups.set(group, [...(groups.get(group) ?? []), session]);
  }
  return [...groups.entries()].map(([group, members]) => ({ group, groupKey: groupOf(members[0] as Session, groupBy).groupKey, members }));
}

function bucketDate(atMs: number, timeZone: string): { readonly date: string; readonly hour: string } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" })
      .formatToParts(atMs)
      .map((part) => [part.type, part.value]),
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:00` };
}

function bucketIds(range: UsageBuckets): readonly { readonly bucketId: string; readonly date: string }[] {
  const seen = new Map<string, string>();
  for (let at = range.from; at < range.to; at += HOUR_MS) {
    const { date, hour } = bucketDate(at, range.timeZone);
    seen.set(range.granularity === "hourly" ? hour : date, date);
  }
  return [...seen.entries()].map(([bucketId, date]) => ({ bucketId, date }));
}

export class UsageService {
  constructor(private readonly helper: HelperCommand) {}

  async totals(range: UsageRange) {
    const sessions = await this.sessions(range);
    const priced = sessions.filter((session) => session.priced).length;
    return { ...totals(sessions), pricedEventCount: priced, unpricedEventCount: sessions.length - priced };
  }

  async breakdown(range: UsageRange, groupBy: string) {
    const breakdown = grouped(await this.sessions(range), groupBy).map(({ group, groupKey, members }) => ({
      group,
      groupId: groupKey,
      groupKey,
      ...totals(members),
      turnCount: null,
    }));
    return { breakdown: breakdown.sort((left, right) => right.totalInputTokens + right.totalOutputTokens - (left.totalInputTokens + left.totalOutputTokens)) };
  }

  async daily(range: UsageBuckets) {
    const buckets = this.inBuckets(await this.sessions(range), range);
    return { buckets: buckets.map(({ bucketId, date, members }) => ({ bucketId, date, ...this.bucketTotals(members) })) };
  }

  async series(range: UsageBuckets, groupBy: string) {
    const buckets = this.inBuckets(await this.sessions(range), range);
    return {
      buckets: buckets.map(({ bucketId, date, members }) => ({
        bucketId,
        date,
        ...this.bucketTotals(members),
        groups: Object.fromEntries(
          grouped(members, groupBy).map(({ group, groupKey, members: inGroup }) => [group, { group, groupKey, ...this.bucketTotals(inGroup) }]),
        ),
      })),
    };
  }

  private bucketTotals(sessions: readonly Session[]) {
    const { totalInputTokens, totalOutputTokens, totalEstimatedCostUsd, eventCount } = totals(sessions);
    return { totalInputTokens, totalOutputTokens, totalEstimatedCostUsd, eventCount };
  }

  private inBuckets(sessions: readonly Session[], range: UsageBuckets) {
    const keyed = sessions.map((session) => {
      const { date, hour } = bucketDate(session.started_at * 1000, range.timeZone);
      return { session, bucketId: range.granularity === "hourly" ? hour : date };
    });
    return bucketIds(range).map(({ bucketId, date }) => ({
      bucketId,
      date,
      members: keyed.filter((entry) => entry.bucketId === bucketId).map((entry) => entry.session),
    }));
  }

  private async sessions(range: UsageRange): Promise<readonly Session[]> {
    const { sessions } = await runHermesHelper(
      this.helper,
      "usage",
      { action: "sessions", from: range.from / 1000, to: range.to / 1000 },
      SessionsResultSchema,
    );
    return range.scheduleId ? sessions.filter((session) => scheduleOf(session) === range.scheduleId) : sessions;
  }
}
