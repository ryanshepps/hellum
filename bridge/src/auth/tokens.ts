import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

const USER_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const USER_CODE_HALF_LENGTH = 4;

export type TokenHash = string & { readonly __brand: "TokenHash" };

export function generateSecret(): string {
  return randomBytes(32).toString("base64url");
}

export function generateUserCode(): string {
  const bytes = randomBytes(USER_CODE_HALF_LENGTH * 2);
  const characters = Array.from(bytes, (byte) => USER_CODE_ALPHABET[byte % USER_CODE_ALPHABET.length] ?? "A");
  return `${characters.slice(0, USER_CODE_HALF_LENGTH).join("")}-${characters.slice(USER_CODE_HALF_LENGTH).join("")}`;
}

export function hashSecret(secret: string): TokenHash {
  return createHash("sha256").update(secret).digest("hex") as TokenHash;
}

export function hashesMatch(left: TokenHash, right: TokenHash): boolean {
  const leftBuffer = Buffer.from(left, "hex");
  const rightBuffer = Buffer.from(right, "hex");
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export function normalizeUserCode(raw: string): string {
  const compact = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return compact.length === USER_CODE_HALF_LENGTH * 2
    ? `${compact.slice(0, USER_CODE_HALF_LENGTH)}-${compact.slice(USER_CODE_HALF_LENGTH)}`
    : compact;
}
