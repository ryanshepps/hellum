import { z } from "zod";
import type { ToolResultPayload } from "../hermes/schemas";

const CommandResultSchema = z.object({
  output: z.string().nullish(),
  exit_code: z.number().nullish(),
  error: z.string().nullish(),
  status: z.string().nullish(),
});

export type FormattedToolResult = {
  readonly text: string;
  readonly isError: boolean;
  readonly status: string | undefined;
};

export function formatToolResult(result: ToolResultPayload): FormattedToolResult {
  if (result === undefined || result === null) {
    return { text: "", isError: false, status: undefined };
  }
  if (typeof result === "string") {
    return { text: result, isError: false, status: undefined };
  }
  const command = CommandResultSchema.safeParse(result);
  if (command.success && (command.data.output !== undefined || command.data.error !== undefined)) {
    const { output, exit_code: exitCode, error, status } = command.data;
    const isError = Boolean(error) || status === "blocked" || (exitCode !== null && exitCode !== undefined && exitCode !== 0);
    const text = [output, error].filter((part): part is string => Boolean(part)).join("\n");
    return { text, isError, status: status ?? undefined };
  }
  return { text: JSON.stringify(result, null, 2), isError: false, status: undefined };
}
