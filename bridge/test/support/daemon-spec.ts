import { readFileSync } from "node:fs";
import { join } from "node:path";

export type JsonSchema = {
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  oneOf?: JsonSchema[];
  const?: unknown;
  enum?: unknown[];
};

type Operation = { responses: Record<string, { content?: Record<string, { schema: JsonSchema }> }> };

const DAEMON_SPEC = JSON.parse(readFileSync(join(import.meta.dir, "../../../clients/web/openapi-schemas/daemon.json"), "utf8")) as {
  paths: Record<string, Record<string, Operation>>;
};

export function responseSchema(path: string, method: string, status = "200"): JsonSchema {
  const schema = DAEMON_SPEC.paths[`/v1/assistants/{assistant_id}/${path}`]?.[method]?.responses[status]?.content?.["application/json"]?.schema;
  if (!schema) throw new Error(`no schema for ${method} ${path}`);
  return schema;
}

export function missingFields(value: Record<string, unknown>, schema: JsonSchema): string[] {
  return (schema.required ?? []).filter((field) => !(field in value));
}

export function variantFor(schema: JsonSchema, value: Record<string, unknown>): JsonSchema {
  return schema.oneOf?.find((variant) => Object.entries(variant.properties ?? {}).every(([key, property]) => property.const === undefined || property.const === value[key])) ?? schema;
}

export function enumViolations(value: Record<string, unknown>, schema: JsonSchema): string[] {
  return Object.entries(schema.properties ?? {}).flatMap(([key, property]) =>
    property.enum && key in value && !property.enum.includes(value[key]) ? [`${key}=${String(value[key])}`] : [],
  );
}
