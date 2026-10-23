import { join } from "node:path";
import { injectConfig, type RemoteGatewayConfig } from "./index-html";
import { resolveSpaRoute } from "./spa-route";

const NO_STORE = "no-store";
const IMMUTABLE = "public, max-age=31536000, immutable";

export type SpaHandler = (request: Request) => Promise<Response | null>;

export function createSpaHandler(webDistDir: string, config: RemoteGatewayConfig): SpaHandler {
  const indexPath = join(webDistDir, "index.html");
  let rendered: { readonly modifiedAt: number; readonly html: Promise<string> } | null = null;
  const renderIndex = (): Promise<string> => {
    const indexFile = Bun.file(indexPath);
    if (rendered?.modifiedAt !== indexFile.lastModified) {
      rendered = { modifiedAt: indexFile.lastModified, html: indexFile.text().then((html) => injectConfig(html, config)) };
    }
    return rendered.html;
  };

  return async (request) => {
    const route = resolveSpaRoute(new URL(request.url).pathname);
    switch (route.kind) {
      case "not-spa":
        return null;
      case "redirect":
        return new Response(null, { status: 302, headers: { Location: route.location } });
      case "config":
        return Response.json(config, { headers: { "Cache-Control": NO_STORE } });
      case "index":
        return new Response(await renderIndex(), {
          headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": NO_STORE },
        });
      case "file": {
        const file = Bun.file(join(webDistDir, route.relativePath));
        if (!(await file.exists())) {
          return new Response("Not found", { status: 404 });
        }
        const cacheControl = route.relativePath.startsWith("assets/") ? IMMUTABLE : NO_STORE;
        return new Response(file, { headers: { "Cache-Control": cacheControl } });
      }
      default: {
        const exhaustive: never = route;
        return exhaustive;
      }
    }
  };
}
