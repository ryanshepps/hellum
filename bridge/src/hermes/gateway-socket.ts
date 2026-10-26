import { z } from "zod";
import { log } from "../log";
import type { GatewayCommand } from "./gateway-process";
import { HermesUnavailableError, type LineTransport } from "./rpc-peer";

const GrantSchema = z.object({ url: z.string(), protocols: z.array(z.string()) });

const BOOTSTRAP_TIMEOUT_MS = 30_000;

async function requestGrant(command: GatewayCommand): Promise<z.infer<typeof GrantSchema>> {
  const child = Bun.spawn([...command.argv], {
    cwd: command.cwd,
    env: { ...command.env },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const timer = setTimeout(() => child.kill(), BOOTSTRAP_TIMEOUT_MS);
  const [exitCode, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  clearTimeout(timer);
  if (exitCode !== 0) {
    throw new HermesUnavailableError(`no Hermes gateway to attach to: ${stderr.trim().split("\n").at(-1) ?? `exit ${exitCode}`}`);
  }
  return GrantSchema.parse(JSON.parse(stdout.trim().split("\n").at(-1) ?? ""));
}

export async function attachGatewaySocket(command: GatewayCommand): Promise<LineTransport> {
  const grant = await requestGrant(command);
  const socket = new WebSocket(grant.url, grant.protocols);
  const lineListeners = new Set<(line: string) => void>();
  const closeListeners = new Set<(reason: string) => void>();

  await new Promise<void>((resolve, reject) => {
    socket.addEventListener("open", () => resolve(), { once: true });
    socket.addEventListener("close", (event) => reject(new HermesUnavailableError(`the Hermes gateway refused the connection (${event.code})`)), { once: true });
  });

  socket.addEventListener("message", (event) => {
    const line = typeof event.data === "string" ? event.data : Buffer.from(event.data as ArrayBuffer).toString("utf8");
    for (const listener of lineListeners) {
      listener(line);
    }
  });
  socket.addEventListener("close", (event) => {
    const reason = `gateway connection closed with code ${event.code}`;
    log.warn("hermes gateway connection closed", { code: event.code, reason: event.reason });
    for (const listener of closeListeners) {
      listener(reason);
    }
  });

  return {
    send: (line) => socket.send(line.trimEnd()),
    onLine: (listener) => {
      lineListeners.add(listener);
    },
    onClose: (listener) => {
      closeListeners.add(listener);
    },
    close: async () => {
      if (socket.readyState === WebSocket.CLOSED) {
        return;
      }
      const closed = new Promise<void>((resolve) => socket.addEventListener("close", () => resolve(), { once: true }));
      socket.close(1000);
      await Promise.race([closed, Bun.sleep(3000)]);
    },
  };
}
