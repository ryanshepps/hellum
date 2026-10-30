import { join } from "node:path";
import { errorResponse } from "../http/json";
import type { Route } from "./route-table";

const AVATAR_FILE = join(import.meta.dir, "../../assets/hellum-avatar.svg");
const AVATAR_IMAGE_PATH = "data/avatar/avatar-image.png";

function absent(): Response {
  return errorResponse(404, "not_found", "No such file");
}

export function avatarRoutes(): readonly Route[] {
  return [
    {
      method: "GET",
      pattern: "workspace/file/content",
      handle: ({ query }) =>
        query.get("path") === AVATAR_IMAGE_PATH ? new Response(Bun.file(AVATAR_FILE), { headers: { "Content-Type": "image/svg+xml" } }) : absent(),
    },
    { method: "GET", pattern: "workspace/file", handle: absent },
    { method: "GET", pattern: "avatar/character-components", handle: absent },
  ];
}
