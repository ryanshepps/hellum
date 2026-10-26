import { afterEach, describe, expect, test } from "bun:test";
import type { Server } from "bun";
import { attachGatewaySocket } from "../../src/hermes/gateway-socket";
import { HermesUnavailableError } from "../../src/hermes/rpc-peer";

let server: Server<undefined> | null = null;

afterEach(() => {
  server?.stop(true);
  server = null;
});

function startGateway(onMessage: (text: string, reply: (text: string) => void) => void): { url: string; protocols: string[] } {
  const protocol = "hermes-gateway-v1";
  server = Bun.serve({
    port: 0,
    fetch: (request, current) =>
      current.upgrade(request, { headers: { "Sec-WebSocket-Protocol": protocol } }) ? undefined : new Response("no", { status: 400 }),
    websocket: {
      open: (socket) => {
        socket.send(JSON.stringify({ jsonrpc: "2.0", method: "event", params: { type: "gateway.ready" } }));
      },
      message: (socket, message) => {
        onMessage(String(message), (text) => {
          socket.send(text);
        });
      },
    },
  });
  return { url: `ws://127.0.0.1:${server.port}/api/ws`, protocols: [protocol, "hermes-gateway-ticket.abc"] };
}

function bootstrapPrinting(output: string, exitCode = 0) {
  return { argv: [process.execPath, "-e", `console.log(${JSON.stringify(output)}); process.exit(${exitCode})`], cwd: process.cwd(), env: { PATH: process.env.PATH } };
}

describe("attachGatewaySocket", () => {
  test("relays each frame as a line in both directions", async () => {
    const grant = startGateway((text, reply) => reply(JSON.stringify({ jsonrpc: "2.0", id: JSON.parse(text).id, result: { pong: true } })));
    const transport = await attachGatewaySocket(bootstrapPrinting(JSON.stringify(grant)));
    const lines: string[] = [];
    const twoLines = new Promise<void>((resolve) =>
      transport.onLine((line) => {
        lines.push(line);
        if (lines.length === 2) resolve();
      }),
    );
    transport.send(`${JSON.stringify({ jsonrpc: "2.0", id: "1", method: "ping", params: {} })}\n`);
    await twoLines;
    expect(lines.map((line) => JSON.parse(line))).toEqual([
      { jsonrpc: "2.0", method: "event", params: { type: "gateway.ready" } },
      { jsonrpc: "2.0", id: "1", result: { pong: true } },
    ]);
    await transport.close();
  });

  test("reports the connection closing", async () => {
    const grant = startGateway(() => undefined);
    const transport = await attachGatewaySocket(bootstrapPrinting(JSON.stringify(grant)));
    const closed = new Promise<string>((resolve) => transport.onClose(resolve));
    server?.stop(true);
    expect(await closed).toContain("closed");
  });

  test("a bootstrap that finds no gateway leaves Hermes unavailable", async () => {
    const attempt = attachGatewaySocket(bootstrapPrinting("gateway unavailable: not_running", 1));
    await expect(attempt).rejects.toBeInstanceOf(HermesUnavailableError);
  });
});
