import { randomUUID } from "node:crypto";
import {
  ACCESS_TOKEN_TTL_MS,
  findAccess,
  grantAccess,
  REFRESH_AFTER_FRACTION,
  revokeDeviceAccess,
  type AccessSession,
  type AccessSessions,
} from "./access-sessions";
import type { AccessStore } from "./access-store";
import {
  addDevice,
  REFRESH_TOKEN_TTL_MS,
  revokeDevice,
  rotateRefreshToken,
  type Device,
  type DeviceRegistry,
  type Platform,
  type RotateOutcome,
} from "./devices";
import type { DeviceStore } from "./device-store";
import {
  approveByUserCode,
  closePairing,
  EMPTY_PAIRING_BOOK,
  openPairing,
  PAIRING_POLL_INTERVAL_SECONDS,
  PAIRING_TTL_MS,
  pendingPairings,
  pollPairing,
  type Pairing,
} from "./pairings";
import { generateSecret, generateUserCode, hashSecret, normalizeUserCode } from "./tokens";

export type Clock = () => number;

export type IssuedPairing = {
  readonly deviceCode: string;
  readonly userCode: string;
  readonly expiresAt: number;
  readonly intervalSeconds: number;
};

export type IssuedSession = {
  readonly accessToken: string;
  readonly accessTokenExpiresAt: number;
  readonly refreshAfter: number;
  readonly refreshToken: string;
  readonly refreshTokenExpiresAt: number;
  readonly deviceId: string;
};

export type DeviceInfo = {
  readonly deviceId: string | undefined;
  readonly platform: Platform;
  readonly name: string;
};

export type RefreshOutcome =
  | { readonly kind: "issued"; readonly session: IssuedSession }
  | Extract<RotateOutcome, { readonly kind: "rejected" }>;

export type ExchangeOutcome =
  | { readonly kind: "pending"; readonly expiresAt: number; readonly intervalSeconds: number }
  | { readonly kind: "approved"; readonly session: IssuedSession }
  | { readonly kind: "unknown" };

export class AuthService {
  private pairings = EMPTY_PAIRING_BOOK;

  private constructor(
    private registry: DeviceRegistry,
    private readonly store: DeviceStore,
    private accessSessions: AccessSessions,
    private readonly accessStore: AccessStore,
    private readonly now: Clock,
  ) {}

  static async open(store: DeviceStore, accessStore: AccessStore, now: Clock = Date.now): Promise<AuthService> {
    return new AuthService(await store.load(), store, await accessStore.load(), accessStore, now);
  }

  createChallenge(): IssuedPairing {
    return this.issuePairing("pending");
  }

  createApprovedPairing(): IssuedPairing {
    return this.issuePairing("approved");
  }

  approve(rawUserCode: string): boolean {
    const outcome = approveByUserCode(this.pairings, normalizeUserCode(rawUserCode), this.now());
    if (outcome.kind === "unknown") {
      return false;
    }
    this.pairings = outcome.book;
    return true;
  }

  listPending(): readonly Pairing[] {
    return pendingPairings(this.pairings, this.now());
  }

  listDevices(): readonly Device[] {
    return this.registry.devices;
  }

  async exchange(deviceCode: string, device: DeviceInfo): Promise<ExchangeOutcome> {
    const deviceCodeHash = hashSecret(deviceCode);
    const outcome = pollPairing(this.pairings, deviceCodeHash, this.now());
    switch (outcome.kind) {
      case "unknown":
        return { kind: "unknown" };
      case "pending":
        return { kind: "pending", expiresAt: outcome.pairing.expiresAt, intervalSeconds: PAIRING_POLL_INTERVAL_SECONDS };
      case "approved": {
        this.pairings = closePairing(this.pairings, deviceCodeHash);
        const refreshToken = generateSecret();
        const deviceId = device.deviceId ?? randomUUID();
        await this.saveRegistry(
          addDevice(
            this.registry,
            { deviceId, name: device.name, platform: device.platform, refreshTokenHash: hashSecret(refreshToken) },
            this.now(),
          ),
        );
        return { kind: "approved", session: await this.issueSession(deviceId, refreshToken) };
      }
      default: {
        const exhaustive: never = outcome;
        return exhaustive;
      }
    }
  }

  async refresh(refreshToken: string): Promise<RefreshOutcome> {
    const nextRefreshToken = generateSecret();
    const outcome = rotateRefreshToken(this.registry, hashSecret(refreshToken), hashSecret(nextRefreshToken), this.now());
    if (outcome.kind === "rejected") {
      return outcome;
    }
    await this.saveRegistry(outcome.registry);
    return { kind: "issued", session: await this.issueSession(outcome.device.deviceId, nextRefreshToken) };
  }

  authenticate(accessToken: string): AccessSession | null {
    return findAccess(this.accessSessions, hashSecret(accessToken), this.now());
  }

  async revoke(deviceId: string): Promise<boolean> {
    const known = this.registry.devices.some((device) => device.deviceId === deviceId);
    if (known) {
      await this.saveRegistry(revokeDevice(this.registry, deviceId));
      await this.saveAccess(revokeDeviceAccess(this.accessSessions, deviceId));
    }
    return known;
  }

  private issuePairing(approval: Pairing["approval"]): IssuedPairing {
    const deviceCode = generateSecret();
    const userCode = generateUserCode();
    const now = this.now();
    this.pairings = openPairing(this.pairings, hashSecret(deviceCode), userCode, approval, now);
    return { deviceCode, userCode, expiresAt: now + PAIRING_TTL_MS, intervalSeconds: PAIRING_POLL_INTERVAL_SECONDS };
  }

  private async issueSession(deviceId: string, refreshToken: string): Promise<IssuedSession> {
    const accessToken = generateSecret();
    const now = this.now();
    await this.saveAccess(grantAccess(revokeDeviceAccess(this.accessSessions, deviceId), hashSecret(accessToken), deviceId, now));
    return {
      accessToken,
      accessTokenExpiresAt: now + ACCESS_TOKEN_TTL_MS,
      refreshAfter: now + Math.floor(ACCESS_TOKEN_TTL_MS * REFRESH_AFTER_FRACTION),
      refreshToken,
      refreshTokenExpiresAt: now + REFRESH_TOKEN_TTL_MS,
      deviceId,
    };
  }

  private saveRegistry(registry: DeviceRegistry): Promise<void> {
    this.registry = registry;
    return this.store.save(registry);
  }

  private saveAccess(sessions: AccessSessions): Promise<void> {
    this.accessSessions = sessions;
    return this.accessStore.save(sessions);
  }
}
