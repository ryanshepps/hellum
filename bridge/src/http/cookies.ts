export const REFRESH_COOKIE_NAME = "hellum_refresh";
const REFRESH_COOKIE_PATH = "/v1/guardian";

export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("Cookie");
  if (!header) {
    return null;
  }
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator !== -1 && part.slice(0, separator).trim() === name) {
      return decodeURIComponent(part.slice(separator + 1).trim());
    }
  }
  return null;
}

export function isSecureRequest(request: Request): boolean {
  const forwardedProto = request.headers.get("X-Forwarded-Proto")?.split(",")[0]?.trim();
  return (forwardedProto ?? new URL(request.url).protocol.replace(":", "")) === "https";
}

export function refreshCookie(token: string, maxAgeSeconds: number, secure: boolean): string {
  const attributes = [
    `${REFRESH_COOKIE_NAME}=${encodeURIComponent(token)}`,
    `Path=${REFRESH_COOKIE_PATH}`,
    `Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}`,
    "HttpOnly",
    "SameSite=Strict",
  ];
  return (secure ? [...attributes, "Secure"] : attributes).join("; ");
}

export function clearedRefreshCookie(secure: boolean): string {
  return refreshCookie("", 0, secure);
}
