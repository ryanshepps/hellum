import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseTurnEvent, type HermesTurnEvent } from "../../src/hermes/schemas";
import { parseFrame } from "../../src/hermes/wire";

export type TraceName = "hello" | "tool" | "approval";

export function readTraceLines(name: TraceName): readonly string[] {
  return readFileSync(join(import.meta.dir, "../fixtures/hermes-traces", `${name}.jsonl`), "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0);
}

export function readTurnEvents(name: TraceName): readonly HermesTurnEvent[] {
  return readTraceLines(name).flatMap((line) => {
    const frame = parseFrame(line);
    const event = frame.kind === "event" ? parseTurnEvent(frame.event.type, frame.event.payload) : null;
    return event ? [event] : [];
  });
}
