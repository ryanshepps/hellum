import { z } from "zod";
import type { TokenHash } from "./tokens";

export const REFRESH_TOKEN_TTL_MS = 90 * 24 * 60 * 60 * 1000;

export const PLATFORMS = ["cli", "desktop", "ios", "android"] as const;
export type Platform = (typeof PLATFORMS)[number];

const DeviceSchema = z.object({
  deviceId: z.string().min(1),
  name: z.string(),
  platform: z.enum(PLATFORMS),
  refreshTokenHash: z.string().regex(/^[0-9a-f]{64}$/),
  refreshExpiresAt: z.number(),
  pairedAt: z.number(),
  lastSeenAt: z.number(),
});

export const DeviceRegistrySchema = z.object({ devices: z.array(DeviceSchema) });

export type Device = {
  readonly deviceId: string;
  readonly name: string;
  readonly platform: Platform;
  readonly refreshTokenHash: TokenHash;
  readonly refreshExpiresAt: number;
  readonly pairedAt: number;
  readonly lastSeenAt: number;
};

export type DeviceRegistry = { readonly devices: readonly Device[] };

export const EMPTY_REGISTRY: DeviceRegistry = { devices: [] };

export type NewDevice = {
  readonly deviceId: string;
  readonly name: string;
  readonly platform: Platform;
  readonly refreshTokenHash: TokenHash;
};

export function addDevice(registry: DeviceRegistry, device: NewDevice, now: number): DeviceRegistry {
  const others = registry.devices.filter((existing) => existing.deviceId !== device.deviceId);
  return {
    devices: [...others, { ...device, refreshExpiresAt: now + REFRESH_TOKEN_TTL_MS, pairedAt: now, lastSeenAt: now }],
  };
}

export type RotateOutcome =
  | { readonly kind: "rotated"; readonly registry: DeviceRegistry; readonly device: Device }
  | { readonly kind: "rejected" };

export function rotateRefreshToken(
  registry: DeviceRegistry,
  presentedHash: TokenHash,
  nextHash: TokenHash,
  now: number,
): RotateOutcome {
  const device = registry.devices.find((candidate) => candidate.refreshTokenHash === presentedHash);
  if (!device || device.refreshExpiresAt <= now) {
    return { kind: "rejected" };
  }
  const rotated: Device = {
    ...device,
    refreshTokenHash: nextHash,
    refreshExpiresAt: now + REFRESH_TOKEN_TTL_MS,
    lastSeenAt: now,
  };
  return {
    kind: "rotated",
    registry: { devices: registry.devices.map((candidate) => (candidate === device ? rotated : candidate)) },
    device: rotated,
  };
}

export function revokeDevice(registry: DeviceRegistry, deviceId: string): DeviceRegistry {
  return { devices: registry.devices.filter((device) => device.deviceId !== deviceId) };
}

export function parseDeviceRegistry(raw: unknown): DeviceRegistry {
  const parsed = DeviceRegistrySchema.parse(raw);
  return {
    devices: parsed.devices.map((device) => ({ ...device, refreshTokenHash: device.refreshTokenHash as TokenHash })),
  };
}
