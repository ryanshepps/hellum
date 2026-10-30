import { z } from "zod";
import { runHermesHelper, type HelperCommand } from "../hermes/helper-process";

const HermesServerSchema = z.object({
  name: z.string(),
  enabled: z.boolean(),
  url: z.string().nullable(),
  command: z.string().nullable(),
  args: z.array(z.string()),
  transport: z.string().nullable(),
  oauth: z.boolean(),
  header_names: z.array(z.string()),
});
type HermesServer = z.infer<typeof HermesServerSchema>;

const ListResultSchema = z.object({ success: z.literal(true), servers: z.array(HermesServerSchema) });
const ToolsResultSchema = z.object({
  success: z.literal(true),
  servers: z.record(z.string(), z.array(z.object({ name: z.string(), description: z.string() }))),
});
const WriteResultSchema = z.object({ success: z.boolean(), error: z.string().nullable() });

const TOOLS_TIMEOUT_MS = 60_000;
const CHARS_PER_TOKEN = 4;

export const McpAddBodySchema = z.object({
  name: z.string().trim().regex(/^[A-Za-z0-9_-]+$/),
  transportType: z.string(),
  url: z.string().optional(),
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  headers: z.record(z.string(), z.string()).optional(),
});
export const McpUpdateBodySchema = z.object({ name: z.string().min(1), headers: z.record(z.string(), z.string()).nullable().optional() });
export const McpRemoveBodySchema = z.object({ name: z.string().min(1) });

export class McpRejectedError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "McpRejectedError";
  }
}

function transport(server: HermesServer) {
  if (server.command) {
    return { type: "stdio" as const, command: server.command, args: server.args };
  }
  return { type: server.transport === "sse" ? ("sse" as const) : ("streamable-http" as const), url: server.url ?? "" };
}

function authType(server: HermesServer): "none" | "bearer" | "api-key" {
  if (server.header_names.length === 0) {
    return "none";
  }
  return server.header_names.some((name) => name.toLowerCase() === "authorization") ? "bearer" : "api-key";
}

function serverStatus(server: HermesServer): string {
  if (!server.enabled) {
    return "disabled";
  }
  return server.oauth ? "needs-auth" : "connected";
}

function toEntry(server: HermesServer) {
  const auth = authType(server);
  return {
    id: server.name,
    status: serverStatus(server),
    source: "workspace",
    transport: transport(server),
    hasOAuth: server.oauth,
    hasStaticAuth: server.header_names.length > 0,
    authType: auth,
    ...(auth === "api-key" ? { authHeaderName: server.header_names[0] } : {}),
  };
}

export class McpService {
  constructor(
    private readonly helper: HelperCommand,
    private readonly onServersChanged: () => void,
  ) {}

  async list() {
    const { servers } = await runHermesHelper(this.helper, "mcp", { action: "list" }, ListResultSchema);
    return { servers: servers.map(toEntry) };
  }

  async toolsSummary() {
    const { servers } = await runHermesHelper(this.helper, "mcp", { action: "tools" }, ToolsResultSchema, TOOLS_TIMEOUT_MS);
    const summaries = Object.entries(servers).map(([serverId, tools]) => {
      const entries = tools.map((tool) => ({ ...tool, estimatedTokens: Math.ceil((tool.name.length + tool.description.length) / CHARS_PER_TOKEN) }));
      return { serverId, toolCount: entries.length, estimatedTokens: entries.reduce((sum, tool) => sum + tool.estimatedTokens, 0), tools: entries };
    });
    return {
      servers: summaries,
      totalToolCount: summaries.reduce((sum, server) => sum + server.toolCount, 0),
      totalEstimatedTokens: summaries.reduce((sum, server) => sum + server.estimatedTokens, 0),
    };
  }

  add(body: z.infer<typeof McpAddBodySchema>): Promise<void> {
    return this.change({ action: "add", name: body.name, url: body.url, command: body.command, args: body.args, headers: body.headers });
  }

  update(body: z.infer<typeof McpUpdateBodySchema>): Promise<void> {
    return this.change({ action: "update", ...body });
  }

  remove(name: string): Promise<void> {
    return this.change({ action: "remove", name });
  }

  private async change(request: object): Promise<void> {
    const result = await runHermesHelper(this.helper, "mcp", request, WriteResultSchema);
    if (!result.success) {
      throw new McpRejectedError(result.error ?? "Hermes rejected the change");
    }
    this.onServersChanged();
  }
}
