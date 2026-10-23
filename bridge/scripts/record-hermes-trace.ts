import { writeFile } from "node:fs/promises";
import { z } from "zod";
import { loadConfig } from "../src/config";
import { spawnGatewayProcess } from "../src/hermes/gateway-process";
import { HermesRpcPeer } from "../src/hermes/rpc-peer";

const [outputPath, ...prompts] = process.argv.slice(2);
if (!outputPath || prompts.length === 0) {
  process.stderr.write("Usage: bun run scripts/record-hermes-trace.ts <output.jsonl> <prompt> [prompt...]\n");
  process.exit(1);
}

const TURN_TIMEOUT_MS = 180_000;
const config = loadConfig(process.env);
const transport = spawnGatewayProcess(config.hermesGateway);
const frames: string[] = [];
transport.onLine((line) => frames.push(line));
const peer = new HermesRpcPeer(transport);
await peer.ready;

const created = await peer.request(
  "session.create",
  { source: "hellum-trace", title: "Hellum trace recording", cwd: process.env.TRACE_CWD ?? null },
  z.object({ session_id: z.string() }).passthrough(),
);
const sid = created.session_id;

peer.onEvent((event) => {
  if (event.sessionId === sid && event.type === "approval.request") {
    void peer.request("approval.respond", { session_id: sid, choice: process.env.TRACE_APPROVAL ?? "once" }, z.unknown());
  }
});

for (const text of prompts) {
  const finished = new Promise<void>((resolve) => {
    const stop = peer.onEvent((event) => {
      if (event.sessionId === sid && (event.type === "message.complete" || event.type === "error")) {
        stop();
        resolve();
      }
    });
  });
  await peer.request("prompt.submit", { session_id: sid, text }, z.unknown());
  await Promise.race([finished, Bun.sleep(TURN_TIMEOUT_MS)]);
}

await peer.request("session.history", { session_id: sid }, z.unknown());
const storedId = frames
  .map((line) => z.object({ result: z.object({ session_key: z.string() }) }).safeParse(JSON.parse(line)))
  .find((parsed) => parsed.success)?.data?.result.session_key;
await writeFile(outputPath, `${frames.join("\n")}\n`);
process.stdout.write(`Recorded ${frames.length} frames to ${outputPath} (live ${sid}, stored ${storedId ?? "unknown"})\n`);
await peer.close();
