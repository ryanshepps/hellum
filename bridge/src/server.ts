import { adminSocketPath, startAdminServer } from "./admin/admin-server";
import { createAuthRoutes } from "./auth/auth-routes";
import { AuthService } from "./auth/auth-service";
import { createFileDeviceStore } from "./auth/device-store";
import type { BridgeConfig } from "./config";
import { bearerToken, errorResponse } from "./http/json";
import { log } from "./log";
import { buildRemoteGatewayConfig } from "./spa/index-html";
import { createSpaHandler } from "./spa/spa-handler";

export type BridgeServer = {
  readonly url: URL;
  readonly adminSocketPath: string;
  readonly stop: () => Promise<void>;
};

function notFound(request: Request): Response {
  const url = new URL(request.url);
  log.warn("unhandled route", { method: request.method, path: url.pathname, query: url.search });
  return errorResponse(404, "not_found", "Not supported by Hellum");
}

export async function startBridge(config: BridgeConfig): Promise<BridgeServer> {
  const auth = await AuthService.open(createFileDeviceStore(config.stateDir));
  const spa = createSpaHandler(config.webDistDir, buildRemoteGatewayConfig(config.assistantName, config.assistantId));
  const authRoutes = createAuthRoutes(auth, config.assistantId);
  const socketPath = adminSocketPath(config.stateDir);
  const admin = await startAdminServer(auth, socketPath);

  async function handleApi(request: Request): Promise<Response> {
    const token = bearerToken(request);
    if (!token || !auth.authenticate(token)) {
      return errorResponse(401, "unauthorized", "Missing or expired access token");
    }
    return notFound(request);
  }

  const server = Bun.serve({
    hostname: config.host,
    port: config.port,
    async fetch(request) {
      const response = (await spa(request)) ?? (await authRoutes(request));
      if (response) {
        return response;
      }
      return new URL(request.url).pathname.startsWith("/v1/") ? handleApi(request) : notFound(request);
    },
  });

  return {
    url: server.url,
    adminSocketPath: socketPath,
    stop: async () => {
      await server.stop(true);
      await admin.stop();
    },
  };
}
