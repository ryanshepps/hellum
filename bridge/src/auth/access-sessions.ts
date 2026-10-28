import type { TokenHash } from "./tokens";

export const ACCESS_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const REFRESH_AFTER_FRACTION = 0.8;

export type AccessSession = {
  readonly deviceId: string;
  readonly expiresAt: number;
};

export type AccessSessions = ReadonlyMap<TokenHash, AccessSession>;

export function grantAccess(sessions: AccessSessions, tokenHash: TokenHash, deviceId: string, now: number): AccessSessions {
  const live = [...sessions].filter(([, session]) => session.expiresAt > now);
  return new Map([...live, [tokenHash, { deviceId, expiresAt: now + ACCESS_TOKEN_TTL_MS }]]);
}

export function findAccess(sessions: AccessSessions, tokenHash: TokenHash, now: number): AccessSession | null {
  const session = sessions.get(tokenHash);
  return session && session.expiresAt > now ? session : null;
}

export function revokeDeviceAccess(sessions: AccessSessions, deviceId: string): AccessSessions {
  return new Map([...sessions].filter(([, session]) => session.deviceId !== deviceId));
}
