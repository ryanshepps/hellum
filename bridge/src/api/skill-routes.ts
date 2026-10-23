import { z } from "zod";
import { errorResponse, readJsonBody } from "../http/json";
import type { SkillService } from "../skills/skill-service";
import type { Route } from "./route-table";

const InstallBodySchema = z.object({ slug: z.string().trim().min(1) });

export function skillRoutes(skills: SkillService): readonly Route[] {
  return [
    {
      method: "GET",
      pattern: "skills",
      handle: async ({ query }) =>
        Response.json(
          await skills.list({
            includeCatalog: query.get("include") === "catalog",
            kind: query.get("kind"),
            origin: query.get("origin"),
            search: query.get("q"),
            category: query.get("category"),
          }),
        ),
    },
    { method: "GET", pattern: "skills/categories", handle: async () => Response.json({ categories: await skills.categories() }) },
    {
      method: "POST",
      pattern: "skills/install",
      handle: async ({ request }) => {
        const body = await readJsonBody(request, InstallBodySchema);
        if (!body) {
          return errorResponse(400, "invalid_request", "slug is required");
        }
        await skills.install(body.slug);
        return Response.json({ ok: true, skillId: body.slug });
      },
    },
    { method: "GET", pattern: "skills/:id", handle: async ({ params }) => Response.json({ skill: await skills.get(params.id ?? "") }) },
    {
      method: "DELETE",
      pattern: "skills/:id",
      handle: async ({ params }) => {
        await skills.remove(params.id ?? "");
        return Response.json({ ok: true });
      },
    },
    { method: "GET", pattern: "skills/:id/files", handle: async ({ params }) => Response.json(await skills.files(params.id ?? "")) },
    {
      method: "GET",
      pattern: "skills/:id/files/content",
      handle: async ({ params, query }) => Response.json(await skills.file(params.id ?? "", query.get("path") ?? "SKILL.md")),
    },
    {
      method: "GET",
      pattern: "skills/:id/history",
      handle: async ({ params }) => Response.json({ skillId: (await skills.get(params.id ?? "")).id, revisions: [], truncatedByCompaction: false }),
    },
  ];
}
