import type { BridgeConfig } from "./config";
import { log } from "./log";
import { buildRemoteGatewayConfig } from "./spa/index-html";
import { createSpaHandler } from "./spa/spa-handler";

export type BridgeServer = {
  readonly url: URL;
  readonly stop: () => Promise<void>;
};

function notFound(request: Request): Response {
  const url = new URL(request.url);
  log.warn("unhandled route", { method: request.method, path: url.pathname, query: url.search });
  return Response.json({ error: { code: "not_found", message: "Not supported by Hellum" } }, { status: 404 });
}

export function startBridge(config: BridgeConfig): BridgeServer {
  const spa = createSpaHandler(config.webDistDir, buildRemoteGatewayConfig(config.assistantName, config.assistantId));
  const server = Bun.serve({
    hostname: config.host,
    port: config.port,
    async fetch(request) {
      return (await spa(request)) ?? notFound(request);
    },
  });
  return {
    url: server.url,
    stop: () => server.stop(true),
  };
}
