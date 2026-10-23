import { describe, expect, test } from "bun:test";
import { addDevice, EMPTY_REGISTRY, REFRESH_TOKEN_TTL_MS, revokeDevice, rotateRefreshToken } from "../../src/auth/devices";
import { hashSecret } from "../../src/auth/tokens";

const T0 = 5_000_000;
const first = hashSecret("refresh-1");
const second = hashSecret("refresh-2");
const third = hashSecret("refresh-3");

const registry = addDevice(
  EMPTY_REGISTRY,
  { deviceId: "phone", name: "iPhone", platform: "ios", refreshTokenHash: first },
  T0,
);

describe("device registry", () => {
  test("rotating a refresh token retires the presented one", () => {
    const rotated = rotateRefreshToken(registry, first, second, T0 + 1);
    if (rotated.kind !== "rotated") throw new Error("expected rotation");
    expect(rotated.device.deviceId).toBe("phone");
    expect(rotateRefreshToken(rotated.registry, first, third, T0 + 2).kind).toBe("rejected");
    expect(rotateRefreshToken(rotated.registry, second, third, T0 + 2).kind).toBe("rotated");
  });

  test("an expired refresh token is rejected", () => {
    expect(rotateRefreshToken(registry, first, second, T0 + REFRESH_TOKEN_TTL_MS).kind).toBe("rejected");
  });

  test("re-pairing a device id replaces its old credentials", () => {
    const repaired = addDevice(registry, { deviceId: "phone", name: "iPhone", platform: "ios", refreshTokenHash: second }, T0);
    expect(repaired.devices).toHaveLength(1);
    expect(rotateRefreshToken(repaired, first, third, T0).kind).toBe("rejected");
  });

  test("a revoked device can no longer refresh", () => {
    expect(rotateRefreshToken(revokeDevice(registry, "phone"), first, second, T0).kind).toBe("rejected");
  });
});
