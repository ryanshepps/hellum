import { chmod, mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
import type { AuthService } from "../auth/auth-service";
import { errorResponse, readJsonBody } from "../http/json";

const ApproveBodySchema = z.object({ userCode: z.string().min(1) });

export function adminSocketPath(stateDir: string): string {
  return join(stateDir, "admin.sock");
}

async function route(auth: AuthService, request: Request): Promise<Response> {
  const { pathname } = new URL(request.url);
  const deviceMatch = /^\/devices\/([^/]+)$/.exec(pathname);
  if (request.method === "POST" && pathname === "/pairings") {
    return Response.json(auth.createApprovedPairing());
  }
  if (request.method === "GET" && pathname === "/pairings") {
    return Response.json({ pending: auth.listPending().map(({ userCode, expiresAt }) => ({ userCode, expiresAt })) });
  }
  if (request.method === "POST" && pathname === "/pairings/approve") {
    const body = await readJsonBody(request, ApproveBodySchema);
    if (!body) {
      return errorResponse(400, "invalid_request", "userCode is required");
    }
    return auth.approve(body.userCode)
      ? Response.json({ status: "approved" })
      : errorResponse(404, "not_found", "No pending pairing has that code");
  }
  if (request.method === "GET" && pathname === "/devices") {
    return Response.json({
      devices: auth.listDevices().map(({ deviceId, name, platform, pairedAt, lastSeenAt }) => ({
        deviceId,
        name,
        platform,
        pairedAt,
        lastSeenAt,
      })),
    });
  }
  if (request.method === "DELETE" && deviceMatch?.[1]) {
    return (await auth.revoke(decodeURIComponent(deviceMatch[1])))
      ? Response.json({ status: "revoked" })
      : errorResponse(404, "not_found", "No paired device has that id");
  }
  return errorResponse(404, "not_found", "Unknown admin route");
}

export type AdminServer = { readonly stop: () => Promise<void> };

export async function startAdminServer(auth: AuthService, socketPath: string): Promise<AdminServer> {
  await mkdir(dirname(socketPath), { recursive: true, mode: 0o700 });
  await rm(socketPath, { force: true });
  const server = Bun.serve({ unix: socketPath, fetch: (request) => route(auth, request) });
  await chmod(socketPath, 0o600);
  return {
    stop: async () => {
      await server.stop(true);
      await rm(socketPath, { force: true });
    },
  };
}
