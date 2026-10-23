import { normalize } from "node:path";

export type SpaRoute =
  | { readonly kind: "redirect"; readonly location: string }
  | { readonly kind: "config" }
  | { readonly kind: "index" }
  | { readonly kind: "file"; readonly relativePath: string }
  | { readonly kind: "not-spa" };

const SPA_PREFIX = "/assistant/";
const INDEX_PATHS: ReadonlySet<string> = new Set(["", "index.html"]);

export function resolveSpaRoute(pathname: string): SpaRoute {
  if (pathname === "/" || pathname === "/assistant") {
    return { kind: "redirect", location: SPA_PREFIX };
  }
  if (!pathname.startsWith(SPA_PREFIX)) {
    return { kind: "not-spa" };
  }
  const relative = decodeURIComponent(pathname.slice(SPA_PREFIX.length));
  if (relative === "__config") {
    return { kind: "config" };
  }
  if (INDEX_PATHS.has(relative)) {
    return { kind: "index" };
  }
  const normalized = normalize(relative);
  if (normalized.startsWith("..") || normalized.startsWith("/") || normalized.includes("\0")) {
    return { kind: "not-spa" };
  }
  return looksLikeAsset(normalized) ? { kind: "file", relativePath: normalized } : { kind: "index" };
}

function looksLikeAsset(relativePath: string): boolean {
  const lastSegment = relativePath.split("/").at(-1) ?? "";
  return lastSegment.includes(".");
}
