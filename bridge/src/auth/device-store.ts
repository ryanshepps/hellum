import { join } from "node:path";
import { privateJsonFile } from "../storage/json-file";
import { DeviceRegistrySchema, parseDeviceRegistry, type DeviceRegistry } from "./devices";

export type DeviceStore = {
  readonly load: () => Promise<DeviceRegistry>;
  readonly save: (registry: DeviceRegistry) => Promise<void>;
};

export function createFileDeviceStore(stateDir: string): DeviceStore {
  const file = privateJsonFile(join(stateDir, "devices.json"), DeviceRegistrySchema, { devices: [] });
  return {
    load: async () => parseDeviceRegistry(await file.read()),
    save: (registry) => file.write({ devices: registry.devices.map((device) => ({ ...device, rotatedTokenHashes: [...device.rotatedTokenHashes] })) }),
  };
}
