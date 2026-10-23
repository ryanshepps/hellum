import type { Route } from "./route-table";

const VERSION = "hellum-0.1.0";

const DEFAULT_CONFIG = {
  conversations: { autoArchive: { enabled: false, afterDays: 30 } },
  notifications: { newMessageEnabled: true, allAlertsEnabled: false },
  memory: { enabled: true },
} as const;

const DEFAULT_SOUNDS = { globalEnabled: false, volume: 0.5, events: {} } as const;

const DEFAULT_THRESHOLDS = { interactive: "medium", autonomous: "low", headless: "low" } as const;

function json(body: object, status = 200): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export function systemRoutes(): readonly Route[] {
  return [
    {
      method: "GET",
      pattern: "healthz",
      handle: () =>
        json({
          status: "ok",
          timestamp: new Date().toISOString(),
          version: VERSION,
          disk: null,
          memory: { currentMb: Math.round(process.memoryUsage().rss / 1_048_576), maxMb: 0 },
          cpu: { currentPercent: 0, maxCores: navigator.hardwareConcurrency },
          migrations: { dbVersion: 0, lastWorkspaceMigrationId: null },
          ces: { connected: false },
          capabilities: { memoryOptOut: false, retryLastTurn: false, appPins: false },
        }),
    },
    { method: "GET", pattern: "config", handle: () => json(DEFAULT_CONFIG) },
    { method: "PATCH", pattern: "config", handle: () => json(DEFAULT_CONFIG) },
    { method: "GET", pattern: "feature-flags", handle: () => json({ flags: [] }) },
    { method: "GET", pattern: "permissions/thresholds", handle: () => json(DEFAULT_THRESHOLDS) },
    { method: "GET", pattern: "sounds/config", handle: () => json(DEFAULT_SOUNDS) },
    { method: "PUT", pattern: "sounds/config", handle: () => json(DEFAULT_SOUNDS) },
    { method: "GET", pattern: "workspace/theme", handle: () => json({ theme: null, source: "none", issues: [] }) },
    { method: "GET", pattern: "apps", handle: () => json({ apps: [] }) },
    { method: "GET", pattern: "groups", handle: () => json({ groups: [] }) },
    { method: "POST", pattern: "telemetry/ingest", handle: () => json({ skipped: true }) },
    {
      method: "GET",
      pattern: "home/feed",
      handle: () =>
        json({
          items: [],
          updatedAt: new Date().toISOString(),
          contextBanner: { greeting: "", timeAwayLabel: "", newCount: 0 },
          suggestedPrompts: [],
        }),
    },
    { method: "GET", pattern: "conversations/unread-count", handle: () => json({ count: 0 }) },
    { method: "GET", pattern: "conversations/attention", handle: () => json({ conversations: [], hasMore: false }) },
    { method: "POST", pattern: "conversations/seen", handle: () => json({ ok: true }) },
    { method: "GET", pattern: "acp/sessions", handle: () => json({ sessions: [] }) },
    { method: "GET", pattern: "background-tools", handle: () => json({ tools: [], completed: [] }) },
    { method: "GET", pattern: "documents", handle: () => json({ documents: [] }) },
    { method: "GET", pattern: "suggestion", handle: () => json({ suggestion: null, messageId: null, source: "none" }) },
    {
      method: "GET",
      pattern: "permissions/thresholds/conversations/:conversationId",
      handle: () => json({ threshold: DEFAULT_THRESHOLDS.interactive }),
    },
  ];
}
