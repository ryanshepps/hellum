import { log } from "../log";
import type { LineTransport } from "./rpc-peer";
import { splitLines } from "./wire";

export type GatewayCommand = {
  readonly argv: readonly string[];
  readonly cwd: string;
  readonly env: Readonly<Record<string, string | undefined>>;
};

const STDERR_TAIL_LINES = 20;

export function spawnGatewayProcess(command: GatewayCommand): LineTransport {
  const lineListeners = new Set<(line: string) => void>();
  const closeListeners = new Set<(reason: string) => void>();
  const stderrTail: string[] = [];

  const child = Bun.spawn([...command.argv], {
    cwd: command.cwd,
    env: { ...command.env },
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });

  async function pump(stream: ReadableStream<Uint8Array>, onLine: (line: string) => void): Promise<void> {
    const decoder = new TextDecoder();
    let rest = "";
    for await (const chunk of stream) {
      const split = splitLines(rest, decoder.decode(chunk, { stream: true }));
      rest = split.rest;
      for (const line of split.lines) {
        onLine(line);
      }
    }
  }

  void pump(child.stdout, (line) => {
    for (const listener of lineListeners) {
      listener(line);
    }
  });
  void pump(child.stderr, (line) => {
    stderrTail.push(line);
    if (stderrTail.length > STDERR_TAIL_LINES) {
      stderrTail.shift();
    }
  });
  void child.exited.then((exitCode) => {
    const reason = `gateway exited with code ${exitCode}`;
    log.warn("hermes gateway exited", { exitCode, stderr: stderrTail.join(" | ").slice(-2000) });
    for (const listener of closeListeners) {
      listener(reason);
    }
  });

  return {
    send: (line) => {
      child.stdin.write(line);
      void child.stdin.flush();
    },
    onLine: (listener) => {
      lineListeners.add(listener);
    },
    onClose: (listener) => {
      closeListeners.add(listener);
    },
    close: async () => {
      await child.stdin.end();
      const exited = await Promise.race([child.exited, Bun.sleep(3000).then(() => null)]);
      if (exited === null) {
        child.kill();
        await child.exited;
      }
    },
  };
}
