import { z } from "zod";
import { clearedRefreshCookie, isSecureRequest, readCookie, REFRESH_COOKIE_NAME, refreshCookie } from "../http/cookies";
import { errorResponse, readJsonBody } from "../http/json";
import type { AuthService, IssuedSession } from "./auth-service";
import { PLATFORMS } from "./devices";
import { describeUserAgent } from "./user-agent";

const PAIRING_CHALLENGE_PATH = "/v1/remote-web/pairing-challenge";
const PAIRING_TOKEN_PATH = "/v1/remote-web/pairing-token";
const GUARDIAN_REFRESH_PATH = "/v1/guardian/refresh";
const GUARDIAN_ID = "hellum-owner";

const ChallengeBodySchema = z.object({ publicBaseUrl: z.string().optional() });

const TokenBodySchema = z.object({
  deviceCode: z.string().min(1),
  deviceId: z.string().min(1).max(200).optional(),
  platform: z.enum(PLATFORMS).optional(),
  clientReportedName: z.string().max(200).optional(),
});

export type AuthRoutes = (request: Request) => Promise<Response | null>;

function toIso(epochMs: number): string {
  return new Date(epochMs).toISOString();
}

function sessionResponse(session: IssuedSession, assistantId: string, request: Request): Response {
  const body = {
    status: "approved",
    accessToken: session.accessToken,
    accessTokenExpiresAt: toIso(session.accessTokenExpiresAt),
    refreshAfter: toIso(session.refreshAfter),
    guardianId: GUARDIAN_ID,
    assistantId,
  };
  const maxAgeSeconds = (session.refreshTokenExpiresAt - Date.now()) / 1000;
  return Response.json(body, {
    headers: {
      "Cache-Control": "no-store",
      "Set-Cookie": refreshCookie(session.refreshToken, maxAgeSeconds, isSecureRequest(request)),
    },
  });
}

function publicBaseUrl(request: Request, claimed: string | undefined): string {
  const origin = new URL(request.url).origin;
  return claimed && URL.canParse(claimed) ? claimed : origin;
}

export function createAuthRoutes(auth: AuthService, assistantId: string): AuthRoutes {
  async function handleChallenge(request: Request): Promise<Response> {
    const body = await readJsonBody(request, ChallengeBodySchema);
    const pairing = auth.createChallenge();
    const now = Date.now();
    return Response.json(
      {
        deviceCode: pairing.deviceCode,
        userCode: pairing.userCode,
        verificationUri: `${publicBaseUrl(request, body?.publicBaseUrl)}/assistant/pair`,
        expiresAt: toIso(pairing.expiresAt),
        expiresInSeconds: Math.max(0, Math.round((pairing.expiresAt - now) / 1000)),
        intervalSeconds: pairing.intervalSeconds,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  async function handleToken(request: Request): Promise<Response> {
    const body = await readJsonBody(request, TokenBodySchema);
    if (!body) {
      return errorResponse(400, "invalid_request", "deviceCode is required");
    }
    const described = describeUserAgent(request.headers.get("User-Agent"));
    const outcome = await auth.exchange(body.deviceCode, {
      deviceId: body.deviceId,
      platform: body.platform ?? described.platform,
      name: body.clientReportedName ?? described.name,
    });
    switch (outcome.kind) {
      case "unknown":
        return errorResponse(401, "expired_token", "The pairing code is unknown or expired");
      case "pending":
        return Response.json(
          { status: "pending", expiresAt: toIso(outcome.expiresAt), intervalSeconds: outcome.intervalSeconds },
          { status: 202, headers: { "Cache-Control": "no-store" } },
        );
      case "approved":
        return sessionResponse(outcome.session, assistantId, request);
      default: {
        const exhaustive: never = outcome;
        return exhaustive;
      }
    }
  }

  async function handleRefresh(request: Request): Promise<Response> {
    const presented = readCookie(request, REFRESH_COOKIE_NAME);
    const session = presented ? await auth.refresh(presented) : null;
    if (!session) {
      const response = errorResponse(401, "unauthorized", "Pair this device again");
      response.headers.set("Set-Cookie", clearedRefreshCookie(isSecureRequest(request)));
      return response;
    }
    return sessionResponse(session, assistantId, request);
  }

  return async (request) => {
    if (request.method !== "POST") {
      return null;
    }
    switch (new URL(request.url).pathname) {
      case PAIRING_CHALLENGE_PATH:
        return handleChallenge(request);
      case PAIRING_TOKEN_PATH:
        return handleToken(request);
      case GUARDIAN_REFRESH_PATH:
        return handleRefresh(request);
      default:
        return null;
    }
  };
}
