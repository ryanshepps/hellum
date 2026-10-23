import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../../src/config";
import { startBridge, type BridgeServer } from "../../src/server";

export type TestBridge = BridgeServer & {
  readonly stateDir: string;
  readonly request: (path: string, init?: RequestInit) => Promise<Response>;
  readonly admin: (method: "GET" | "POST" | "DELETE", path: string, body?: object) => Promise<Response>;
  readonly dispose: () => Promise<void>;
};

export async function startTestBridge(env: Readonly<Record<string, string>> = {}): Promise<TestBridge> {
  const stateDir = await mkdtemp(join(tmpdir(), "hellum-bridge-test-"));
  const bridge = await startBridge(
    loadConfig({
      HELLUM_PORT: "0",
      HELLUM_STATE_DIR: stateDir,
      HELLUM_WEB_DIST: join(import.meta.dir, "../fixtures/web"),
      ...env,
    }),
  );
  return {
    ...bridge,
    stateDir,
    request: (path, init) => fetch(new URL(path, bridge.url), init),
    admin: (method, path, body) =>
      fetch(`http://hellum${path}`, {
        method,
        unix: bridge.adminSocketPath,
        ...(body ? { body: JSON.stringify(body) } : {}),
      }),
    dispose: async () => {
      await bridge.stop();
      await rm(stateDir, { recursive: true, force: true });
    },
  };
}

export function postJson(body: object, headers: Readonly<Record<string, string>> = {}): RequestInit {
  return { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) };
}
