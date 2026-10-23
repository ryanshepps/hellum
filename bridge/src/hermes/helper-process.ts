import { join } from "node:path";
import type { z } from "zod";

export type HelperCommand = {
  readonly interpreter: readonly string[];
  readonly scriptsDir: string;
  readonly cwd: string;
  readonly env: Readonly<Record<string, string | undefined>>;
};

export class HermesHelperError extends Error {
  constructor(helper: string, detail: string) {
    super(`Hermes helper ${helper} failed: ${detail}`);
    this.name = "HermesHelperError";
  }
}

const HELPER_TIMEOUT_MS = 30_000;

export async function runHermesHelper<T>(
  command: HelperCommand,
  helper: string,
  request: object,
  schema: z.ZodType<T>,
  timeoutMs = HELPER_TIMEOUT_MS,
): Promise<T> {
  const child = Bun.spawn([...command.interpreter, join(command.scriptsDir, `${helper}.py`)], {
    cwd: command.cwd,
    env: { ...command.env },
    stdin: new Blob([JSON.stringify(request)]),
    stdout: "pipe",
    stderr: "pipe",
  });
  const timer = setTimeout(() => child.kill(), timeoutMs);
  const [exitCode, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  clearTimeout(timer);
  if (exitCode !== 0) {
    throw new HermesHelperError(helper, `exit ${exitCode}: ${stderr.trim().split("\n").at(-1) ?? ""}`);
  }
  const parsed = schema.safeParse(JSON.parse(stdout));
  if (!parsed.success) {
    throw new HermesHelperError(helper, `unexpected output: ${parsed.error.message}`);
  }
  return parsed.data;
}
