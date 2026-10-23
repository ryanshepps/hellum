import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { EMPTY_REGISTRY, parseDeviceRegistry, type DeviceRegistry } from "./devices";

export type DeviceStore = {
  readonly load: () => Promise<DeviceRegistry>;
  readonly save: (registry: DeviceRegistry) => Promise<void>;
};

const PRIVATE_FILE_MODE = 0o600;
const PRIVATE_DIR_MODE = 0o700;

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

export function createFileDeviceStore(stateDir: string): DeviceStore {
  const path = join(stateDir, "devices.json");
  return {
    async load() {
      try {
        return parseDeviceRegistry(JSON.parse(await readFile(path, "utf8")));
      } catch (error) {
        if (isMissingFile(error)) {
          return EMPTY_REGISTRY;
        }
        throw new Error(`Could not read the paired device registry at ${path}`, { cause: error });
      }
    },
    async save(registry) {
      await mkdir(dirname(path), { recursive: true, mode: PRIVATE_DIR_MODE });
      const temporaryPath = `${path}.${process.pid}.tmp`;
      await writeFile(temporaryPath, `${JSON.stringify(registry, null, 2)}\n`, { mode: PRIVATE_FILE_MODE });
      await chmod(temporaryPath, PRIVATE_FILE_MODE);
      await rename(temporaryPath, path);
    },
  };
}
