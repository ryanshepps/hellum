import type { TokenHash } from "./tokens";

export const PAIRING_TTL_MS = 10 * 60 * 1000;
export const PAIRING_POLL_INTERVAL_SECONDS = 3;

export type Pairing = {
  readonly deviceCodeHash: TokenHash;
  readonly userCode: string;
  readonly createdAt: number;
  readonly expiresAt: number;
  readonly approval: "pending" | "approved";
};

export type PairingBook = ReadonlyMap<TokenHash, Pairing>;

export type PollOutcome =
  | { readonly kind: "pending"; readonly pairing: Pairing }
  | { readonly kind: "approved"; readonly pairing: Pairing }
  | { readonly kind: "unknown" };

export type ApproveOutcome =
  | { readonly kind: "approved"; readonly book: PairingBook }
  | { readonly kind: "unknown" };

export const EMPTY_PAIRING_BOOK: PairingBook = new Map();

export function openPairing(
  book: PairingBook,
  deviceCodeHash: TokenHash,
  userCode: string,
  approval: Pairing["approval"],
  now: number,
): PairingBook {
  const pairing: Pairing = { deviceCodeHash, userCode, createdAt: now, expiresAt: now + PAIRING_TTL_MS, approval };
  return new Map([...pruneExpired(book, now), [deviceCodeHash, pairing]]);
}

export function pruneExpired(book: PairingBook, now: number): PairingBook {
  return new Map([...book].filter(([, pairing]) => pairing.expiresAt > now));
}

export function pollPairing(book: PairingBook, deviceCodeHash: TokenHash, now: number): PollOutcome {
  const pairing = pruneExpired(book, now).get(deviceCodeHash);
  if (!pairing) {
    return { kind: "unknown" };
  }
  return pairing.approval === "approved" ? { kind: "approved", pairing } : { kind: "pending", pairing };
}

export function approveByUserCode(book: PairingBook, userCode: string, now: number): ApproveOutcome {
  const live = pruneExpired(book, now);
  const match = [...live.values()].find((pairing) => pairing.userCode === userCode && pairing.approval === "pending");
  if (!match) {
    return { kind: "unknown" };
  }
  return { kind: "approved", book: new Map([...live, [match.deviceCodeHash, { ...match, approval: "approved" }]]) };
}

export function closePairing(book: PairingBook, deviceCodeHash: TokenHash): PairingBook {
  return new Map([...book].filter(([hash]) => hash !== deviceCodeHash));
}

export function pendingPairings(book: PairingBook, now: number): readonly Pairing[] {
  return [...pruneExpired(book, now).values()].filter((pairing) => pairing.approval === "pending");
}
