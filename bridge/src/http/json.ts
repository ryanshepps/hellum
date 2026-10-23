import type { z } from "zod";

export function errorResponse(status: number, code: string, message: string): Response {
  return Response.json({ error: { code, message } }, { status });
}

export async function readJsonBody<T>(request: Request, schema: z.ZodType<T>): Promise<T | null> {
  const raw: unknown = await request.json().catch(() => null);
  const parsed = schema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : null;
}

export function bearerToken(request: Request): string | null {
  const header = request.headers.get("Authorization");
  const match = header ? /^Bearer\s+(.+)$/i.exec(header) : null;
  return match?.[1]?.trim() ?? null;
}
