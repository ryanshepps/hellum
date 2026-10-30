import { existsSync, readFileSync, writeFileSync } from "node:fs";

type Server = { url?: string; command?: string; args?: string[]; headers?: Record<string, string> };

export type McpRequest = Server & { action: string; name?: string };

function stateFile(): string {
  return process.env.FAKE_HERMES_MCP_FILE ?? "";
}

export function readMcpServers(path = stateFile()): Record<string, Server> {
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : {};
}

export function handleMcp(request: McpRequest): object {
  const servers = readMcpServers();
  const name = request.name ?? "";
  const { action: _action, name: _name, ...config } = request;
  switch (request.action) {
    case "list":
      return {
        success: true,
        servers: Object.entries(servers).map(([server, entry]) => ({
          name: server,
          enabled: true,
          url: entry.url ?? null,
          command: entry.command ?? null,
          args: entry.args ?? [],
          transport: null,
          oauth: false,
          header_names: Object.keys(entry.headers ?? {}),
        })),
      };
    case "tools":
      return { success: true, servers: Object.fromEntries(Object.keys(servers).map((server) => [server, [{ name: "search", description: "Find things" }]])) };
    case "add":
      if (servers[name]) {
        return { success: false, error: `${name} already exists` };
      }
      servers[name] = config;
      break;
    case "update":
      if (!servers[name]) {
        return { success: false, error: `No server ${name}` };
      }
      servers[name] = { ...servers[name], ...config };
      break;
    case "remove":
      if (!servers[name]) {
        return { success: false, error: `No server ${name}` };
      }
      delete servers[name];
      break;
    default:
      return { success: false, error: `unknown action ${request.action}` };
  }
  writeFileSync(stateFile(), JSON.stringify(servers));
  return { success: true, error: null };
}
