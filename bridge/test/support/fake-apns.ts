import http2 from "node:http2";
import type { AddressInfo } from "node:net";

export type ReceivedPush = {
  readonly path: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
};

export type FakeApns = {
  readonly origin: string;
  readonly received: readonly ReceivedPush[];
  readonly respondWith: (status: number, reason?: string) => void;
  readonly waitFor: (count: number, timeoutMs?: number) => Promise<readonly ReceivedPush[]>;
  readonly close: () => Promise<void>;
};

export async function startFakeApns(): Promise<FakeApns> {
  const received: ReceivedPush[] = [];
  let reply = { status: 200, reason: "" };
  const server = http2.createServer();
  server.on("stream", (stream: http2.ServerHttp2Stream, rawHeaders: http2.IncomingHttpHeaders) => {
    let body = "";
    stream.on("data", (chunk: Buffer) => {
      body += chunk.toString("utf8");
    });
    stream.on("end", () => {
      const headers = Object.fromEntries(Object.entries(rawHeaders).map(([key, value]) => [key, String(value)]));
      received.push({ path: headers[":path"] ?? "", headers, body });
      stream.respond({ ":status": reply.status, "apns-id": "fake" });
      stream.end(reply.status === 200 ? "" : JSON.stringify({ reason: reply.reason }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    origin: `http://127.0.0.1:${port}`,
    received,
    respondWith: (status, reason = "") => {
      reply = { status, reason };
    },
    async waitFor(count, timeoutMs = 5000) {
      const deadline = Date.now() + timeoutMs;
      while (received.length < count) {
        if (Date.now() > deadline) throw new Error(`expected ${count} pushes, got ${received.length}`);
        await Bun.sleep(10);
      }
      return [...received];
    },
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

export async function generateApnsKeyPem(): Promise<{ readonly pem: string; readonly publicKey: CryptoKey }> {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const pkcs8 = Buffer.from(await crypto.subtle.exportKey("pkcs8", pair.privateKey)).toString("base64");
  const lines = pkcs8.match(/.{1,64}/g) ?? [];
  return { pem: `-----BEGIN PRIVATE KEY-----\n${lines.join("\n")}\n-----END PRIVATE KEY-----\n`, publicKey: pair.publicKey };
}
