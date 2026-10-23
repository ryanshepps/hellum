import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { z } from "zod";

const PRIVATE_FILE_MODE = 0o600;
const PRIVATE_DIR_MODE = 0o700;

export type JsonFile<T> = {
  readonly read: () => Promise<T>;
  readonly write: (value: T) => Promise<void>;
};

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

export function privateJsonFile<T>(path: string, schema: z.ZodType<T>, fallback: T): JsonFile<T> {
  let queue: Promise<void> = Promise.resolve();

  async function persist(value: T): Promise<void> {
    await mkdir(dirname(path), { recursive: true, mode: PRIVATE_DIR_MODE });
    const temporaryPath = `${path}.${randomUUID()}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { mode: PRIVATE_FILE_MODE });
    await chmod(temporaryPath, PRIVATE_FILE_MODE);
    await rename(temporaryPath, path);
  }

  return {
    async read() {
      try {
        return schema.parse(JSON.parse(await readFile(path, "utf8")));
      } catch (error) {
        if (isMissingFile(error)) {
          return fallback;
        }
        throw new Error(`Could not read ${path}`, { cause: error });
      }
    },
    write(value) {
      const next = queue.then(() => persist(value));
      queue = next.catch(() => undefined);
      return next;
    },
  };
}
