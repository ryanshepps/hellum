import { z } from "zod";
import { runHermesHelper, type HelperCommand } from "../hermes/helper-process";
import type { MemorySnapshot, MemoryTarget } from "../translate/memory-graph";

const ListResultSchema = z.object({
  success: z.literal(true),
  memory: z.array(z.string()),
  user: z.array(z.string()),
  modified: z.object({ memory: z.number().nullable(), user: z.number().nullable() }),
});

const WriteResultSchema = z.object({ success: z.boolean(), error: z.string().optional() }).passthrough();

export class MemoryWriteRejectedError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "MemoryWriteRejectedError";
  }
}

function toMs(seconds: number | null): number | null {
  return seconds === null ? null : Math.round(seconds * 1000);
}

export class MemoryService {
  constructor(private readonly helper: HelperCommand) {}

  async snapshot(): Promise<MemorySnapshot> {
    const result = await runHermesHelper(this.helper, "memory", { action: "list" }, ListResultSchema);
    return {
      memory: result.memory,
      user: result.user,
      modifiedAtMs: { memory: toMs(result.modified.memory), user: toMs(result.modified.user) },
    };
  }

  add(target: MemoryTarget, content: string): Promise<void> {
    return this.write({ action: "add", target, content });
  }

  replace(target: MemoryTarget, oldText: string, content: string): Promise<void> {
    return this.write({ action: "replace", target, old_text: oldText, content });
  }

  remove(target: MemoryTarget, oldText: string): Promise<void> {
    return this.write({ action: "remove", target, old_text: oldText });
  }

  private async write(request: object): Promise<void> {
    const result = await runHermesHelper(this.helper, "memory", request, WriteResultSchema);
    if (!result.success) {
      throw new MemoryWriteRejectedError(result.error ?? "Hermes rejected the memory change");
    }
  }
}
