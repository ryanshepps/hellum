import { errorResponse } from "../http/json";
import type { UsageBuckets, UsageRange, UsageService } from "../usage/usage-service";
import type { Route, RouteContext } from "./route-table";

function usageRange(query: URLSearchParams): UsageRange | null {
  const from = Number(query.get("from"));
  const to = Number(query.get("to"));
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) {
    return null;
  }
  return { from, to, scheduleId: query.get("scheduleId") };
}

function usageBuckets(range: UsageRange, query: URLSearchParams, defaultZone: string): UsageBuckets {
  return { ...range, granularity: query.get("granularity") === "hourly" ? "hourly" : "daily", timeZone: query.get("tz") ?? defaultZone };
}

function inRange(respond: (range: UsageRange, query: URLSearchParams) => Promise<object>) {
  return async ({ query }: RouteContext) => {
    const range = usageRange(query);
    return range ? Response.json(await respond(range, query)) : errorResponse(400, "invalid_request", "from and to are required");
  };
}

export function usageRoutes(usage: UsageService, timeZone: string): readonly Route[] {
  return [
    { method: "GET", pattern: "usage/totals", handle: inRange((range) => usage.totals(range)) },
    { method: "GET", pattern: "usage/breakdown", handle: inRange((range, query) => usage.breakdown(range, query.get("groupBy") ?? "model")) },
    { method: "GET", pattern: "usage/daily", handle: inRange((range, query) => usage.daily(usageBuckets(range, query, timeZone))) },
    {
      method: "GET",
      pattern: "usage/series",
      handle: inRange((range, query) => usage.series(usageBuckets(range, query, timeZone), query.get("groupBy") ?? "model")),
    },
  ];
}
