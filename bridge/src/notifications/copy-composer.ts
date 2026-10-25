import { NOTIFICATION_TITLE_MAX_LENGTH } from "./notification-utils";
import { normalizeTitle } from "./short-title";

export function deriveTitle(body: string): string {
  const firstSentenceEnd = body.search(/[.!?](\s|$)/);
  const candidate = firstSentenceEnd > 0 ? body.slice(0, firstSentenceEnd + 1) : body;
  return candidate.length > NOTIFICATION_TITLE_MAX_LENGTH
    ? candidate.slice(0, NOTIFICATION_TITLE_MAX_LENGTH).trim() + "…"
    : candidate.trim();
}

export function resolveTitle(raw: string | undefined, body: string): string {
  return normalizeTitle(raw ?? "") || deriveTitle(body);
}
