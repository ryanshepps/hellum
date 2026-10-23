import type { JsonValue } from "../hermes/schemas";

export type VellumToolCall = {
  readonly toolName: string;
  readonly input: Readonly<Record<string, JsonValue>>;
};

const RUNNING_PREFIX = "Running ";

function commandFrom(context: string | null, args: Readonly<Record<string, JsonValue>>): string {
  const fromArgs = args.command;
  if (typeof fromArgs === "string") {
    return fromArgs;
  }
  return context?.startsWith(RUNNING_PREFIX) ? context.slice(RUNNING_PREFIX.length) : (context ?? "");
}

export function toVellumToolCall(
  hermesName: string,
  context: string | null,
  args: Readonly<Record<string, JsonValue>> = {},
): VellumToolCall {
  if (hermesName === "terminal") {
    return { toolName: "bash", input: { command: commandFrom(context, args) } };
  }
  return { toolName: hermesName, input: context ? { description: context, ...args } : { ...args } };
}
