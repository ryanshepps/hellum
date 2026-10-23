import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { HermesRpcError, HermesRpcPeer, HermesUnavailableError, type LineTransport } from "../../src/hermes/rpc-peer";
import type { HermesEvent } from "../../src/hermes/wire";

type Wire = {
  readonly transport: LineTransport;
  readonly sent: () => readonly { id: string; method: string; params: object }[];
  readonly push: (frame: object) => void;
  readonly pushRaw: (line: string) => void;
  readonly drop: (reason: string) => void;
};

const SentSchema = z.object({ id: z.string(), method: z.string(), params: z.object({}).passthrough() });

function memoryWire(): Wire {
  const lines: string[] = [];
  let onLine: (line: string) => void = () => undefined;
  let onClose: (reason: string) => void = () => undefined;
  return {
    transport: {
      send: (line) => lines.push(line),
      onLine: (listener) => {
        onLine = listener;
      },
      onClose: (listener) => {
        onClose = listener;
      },
      close: async () => undefined,
    },
    sent: () => lines.map((line) => SentSchema.parse(JSON.parse(line))),
    push: (frame) => onLine(JSON.stringify(frame)),
    pushRaw: (line) => onLine(line),
    drop: (reason) => onClose(reason),
  };
}

function lastId(wire: Wire): string {
  return wire.sent().at(-1)?.id ?? "";
}

describe("HermesRpcPeer", () => {
  test("resolves a request with its validated result", async () => {
    const wire = memoryWire();
    const peer = new HermesRpcPeer(wire.transport);
    const pending = peer.request("session.list", { limit: 5 }, z.object({ sessions: z.array(z.string()) }));
    expect(wire.sent()).toEqual([{ id: lastId(wire), method: "session.list", params: { limit: 5 } }]);
    wire.push({ jsonrpc: "2.0", id: lastId(wire), result: { sessions: ["a"] } });
    expect(await pending).toEqual({ sessions: ["a"] });
  });

  test("rejects with the gateway's error code and message", async () => {
    const wire = memoryWire();
    const peer = new HermesRpcPeer(wire.transport);
    const pending = peer.request("session.resume", { session_id: "x" }, z.unknown());
    wire.push({ jsonrpc: "2.0", id: lastId(wire), error: { code: 4007, message: "session not found" } });
    const error = await pending.catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(HermesRpcError);
    expect(error).toMatchObject({ code: 4007, method: "session.resume" });
  });

  test("rejects a result that does not match the expected shape", async () => {
    const wire = memoryWire();
    const peer = new HermesRpcPeer(wire.transport);
    const pending = peer.request("session.list", {}, z.object({ sessions: z.array(z.string()) }));
    wire.push({ jsonrpc: "2.0", id: lastId(wire), result: { rows: [] } });
    expect(await pending.catch((caught: unknown) => caught)).toMatchObject({ code: -2 });
  });

  test("times out a request the gateway never answers", async () => {
    const peer = new HermesRpcPeer(memoryWire().transport);
    const error = await peer.request("session.list", {}, z.unknown(), 10).catch((caught: unknown) => caught);
    expect(error).toMatchObject({ code: -1 });
  });

  test("fails pending and future requests once the gateway goes away", async () => {
    const wire = memoryWire();
    const peer = new HermesRpcPeer(wire.transport);
    const pending = peer.request("session.list", {}, z.unknown());
    wire.drop("gateway exited with code 1");
    expect(await pending.catch((caught: unknown) => caught)).toBeInstanceOf(HermesUnavailableError);
    expect(await peer.request("session.list", {}, z.unknown()).catch((caught: unknown) => caught)).toBeInstanceOf(HermesUnavailableError);
    expect(peer.isClosed).toBe(true);
  });

  test("becomes ready on gateway.ready and fans events out to subscribers", async () => {
    const wire = memoryWire();
    const peer = new HermesRpcPeer(wire.transport);
    const received: HermesEvent[] = [];
    const unsubscribe = peer.onEvent((event) => received.push(event));
    wire.push({ jsonrpc: "2.0", method: "event", params: { type: "gateway.ready", payload: {} } });
    await peer.ready;
    wire.push({ jsonrpc: "2.0", method: "event", params: { type: "message.delta", session_id: "s1", payload: { text: "hi" } } });
    unsubscribe();
    wire.push({ jsonrpc: "2.0", method: "event", params: { type: "message.delta", session_id: "s1", payload: { text: "ignored" } } });
    expect(received).toEqual([
      { type: "gateway.ready", sessionId: null, payload: {} },
      { type: "message.delta", sessionId: "s1", payload: { text: "hi" } },
    ]);
  });

  test("ignores output that is not JSON-RPC", async () => {
    const wire = memoryWire();
    const peer = new HermesRpcPeer(wire.transport);
    const pending = peer.request("session.list", {}, z.unknown());
    wire.pushRaw("[gateway] warming up");
    wire.push({ hello: "world" });
    wire.push({ jsonrpc: "2.0", id: lastId(wire), result: 1 });
    expect(await pending).toBe(1);
  });
});
