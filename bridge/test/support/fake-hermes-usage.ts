export const USAGE_DAY = Date.UTC(2026, 9, 28, 12);

function session(id: string, source: string, model: string, tokens: number, costUsd: number | null, offsetHours: number) {
  return {
    id,
    source,
    model,
    provider: "openrouter",
    started_at: (USAGE_DAY + offsetHours * 3_600_000) / 1000,
    input_tokens: tokens,
    output_tokens: tokens / 10,
    cache_read_tokens: 5,
    cache_write_tokens: 1,
    cost_usd: costUsd,
    priced: costUsd !== null,
  };
}

export function handleUsage(): object {
  return {
    success: true,
    sessions: [
      session("20261028_abc", "local", "claude-sonnet", 1000, 0.5, 0),
      session("cron_job1_20261028", "cron", "claude-sonnet", 2000, 0.25, 1),
      session("20261029_def", "hellum", "gpt-5", 500, null, 24),
    ],
  };
}
