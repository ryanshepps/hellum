import { getCharacterComponents } from "@vellumai/avatar-catalog";
import { normalizeAvatarAccentHex } from "@vellumai/avatar-manifest";
import { z } from "zod";
import { detectImageType, type AvatarStore } from "../avatar/avatar-store";
import { errorResponse, readJsonBody } from "../http/json";
import type { Route } from "./route-table";

const AVATAR_IMAGE_PATH = "data/avatar/avatar-image.png";
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

const TraitsSchema = z.object({ bodyShape: z.string().min(1), eyeStyle: z.string().min(1), color: z.string().min(1) });
const ImageBodySchema = z.object({ content: z.string().min(1), encoding: z.literal("base64").optional() });
const AccentBodySchema = z.object({ hex: z.unknown() });

function absent(): Response {
  return errorResponse(404, "not_found", "No such file");
}

export function avatarRoutes(avatars: AvatarStore): readonly Route[] {
  return [
    { method: "GET", pattern: "avatar/character-components", handle: () => Response.json(getCharacterComponents()) },
    { method: "GET", pattern: "avatar/state", handle: async () => Response.json(await avatars.state()) },
    {
      method: "POST",
      pattern: "avatar/render-from-traits",
      handle: async ({ request }) => {
        const traits = await readJsonBody(request, TraitsSchema);
        if (!traits) {
          return errorResponse(400, "invalid_request", "Missing required fields: bodyShape, eyeStyle, color");
        }
        await avatars.setCharacter(traits);
        return Response.json({ ok: true });
      },
    },
    {
      method: "POST",
      pattern: "avatar/image",
      handle: async ({ request }) => {
        const body = await readJsonBody(request, ImageBodySchema);
        const normalized = body?.content.replace(/\s+/g, "") ?? "";
        if (!normalized || !BASE64.test(normalized)) {
          return errorResponse(400, "invalid_request", "content is not valid base64-encoded image data");
        }
        const bytes = Buffer.from(normalized, "base64");
        if (!detectImageType(bytes)) {
          return errorResponse(400, "invalid_request", "content must be a PNG, JPEG, GIF, or WEBP image");
        }
        await avatars.setImage(bytes);
        return Response.json({ ok: true });
      },
    },
    {
      method: "POST",
      pattern: "avatar/accent",
      handle: async ({ request }) => {
        const body = await readJsonBody(request, AccentBodySchema);
        const hex = body?.hex === null || body?.hex === undefined ? null : normalizeAvatarAccentHex(body.hex);
        if (!body || (hex === null && body.hex !== null && body.hex !== undefined)) {
          return errorResponse(400, "invalid_request", "hex must be a #rrggbb colour, or null");
        }
        const state = await avatars.setAccent(hex);
        return state ? Response.json(state) : errorResponse(400, "invalid_request", "No avatar to set an accent on");
      },
    },
    { method: "POST", pattern: "avatar/remove", handle: async () => Response.json({ ok: true, hadAvatar: await avatars.clear() }) },
    {
      method: "GET",
      pattern: "workspace/file/content",
      handle: async ({ query }) => {
        const image = query.get("path") === AVATAR_IMAGE_PATH ? await avatars.image() : null;
        return image ? new Response(image.bytes, { headers: { "Content-Type": image.contentType, "Cache-Control": "no-store" } }) : absent();
      },
    },
    { method: "GET", pattern: "workspace/file", handle: absent },
  ];
}
