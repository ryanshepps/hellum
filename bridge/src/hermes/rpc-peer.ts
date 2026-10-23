import type { z } from "zod";
import { log } from "../log";
import { encodeRequest, parseFrame, type HermesEvent, type RpcParams } from "./wire";

export type LineTransport = {
  readonly send: (line: string) => void;
  readonly onLine: (listener: (line: string) => void) => void;
  readonly onClose: (listener: (reason: string) => void) => void;
  readonly close: () => Promise<void>;
};

export class HermesRpcError extends Error {
  constructor(
    readonly code: number,
    message: string,
    readonly method: string,
  ) {
    super(`Hermes ${method} failed (${code}): ${message}`);
    this.name = "HermesRpcError";
  }
}

export class HermesUnavailableError extends Error {
  constructor(reason: string) {
    super(`Hermes is unavailable: ${reason}`);
    this.name = "HermesUnavailableError";
  }
}

type PendingRequest = {
  readonly method: string;
  readonly resolve: (result: unknown) => void;
  readonly reject: (error: Error) => void;
  readonly timer: ReturnType<typeof setTimeout>;
};

export type EventListener = (event: HermesEvent) => void;

const DEFAULT_TIMEOUT_MS = 60_000;

export class HermesRpcPeer {
  private nextId = 1;
  private readonly pending = new Map<string, PendingRequest>();
  private readonly listeners = new Set<EventListener>();
  private closedReason: string | null = null;
  readonly ready: Promise<void>;

  constructor(private readonly transport: LineTransport) {
    let markReady: () => void = () => undefined;
    this.ready = new Promise((resolve) => {
      markReady = resolve;
    });
    transport.onLine((line) => this.receive(line, markReady));
    transport.onClose((reason) => this.fail(reason));
  }

  get isClosed(): boolean {
    return this.closedReason !== null;
  }

  onEvent(listener: EventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  request<T>(method: string, params: RpcParams, schema: z.ZodType<T>, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<T> {
    if (this.closedReason !== null) {
      return Promise.reject(new HermesUnavailableError(this.closedReason));
    }
    const id = `hellum-${this.nextId++}`;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new HermesRpcError(-1, `no response after ${timeoutMs} ms`, method));
      }, timeoutMs);
      this.pending.set(id, {
        method,
        timer,
        reject,
        resolve: (result) => {
          const parsed = schema.safeParse(result);
          if (parsed.success) {
            resolve(parsed.data);
          } else {
            reject(new HermesRpcError(-2, `unexpected result shape: ${parsed.error.message}`, method));
          }
        },
      });
      this.transport.send(encodeRequest(id, method, params));
    });
  }

  close(): Promise<void> {
    this.fail("closed by bridge");
    return this.transport.close();
  }

  private receive(line: string, markReady: () => void): void {
    const frame = parseFrame(line);
    switch (frame.kind) {
      case "event":
        if (frame.event.type === "gateway.ready") {
          markReady();
        }
        for (const listener of this.listeners) {
          listener(frame.event);
        }
        return;
      case "result":
        this.settle(frame.id, (request) => request.resolve(frame.result));
        return;
      case "error":
        if (frame.id === null) {
          log.warn("hermes reported an uncorrelated error", { code: frame.code, message: frame.message });
          return;
        }
        this.settle(frame.id, (request) => request.reject(new HermesRpcError(frame.code, frame.message, request.method)));
        return;
      case "invalid":
        log.debug("ignored non-protocol output from hermes", { line: frame.line.slice(0, 200) });
        return;
      default: {
        const exhaustive: never = frame;
        return exhaustive;
      }
    }
  }

  private settle(id: string, apply: (request: PendingRequest) => void): void {
    const request = this.pending.get(id);
    if (!request) {
      return;
    }
    clearTimeout(request.timer);
    this.pending.delete(id);
    apply(request);
  }

  private fail(reason: string): void {
    if (this.closedReason !== null) {
      return;
    }
    this.closedReason = reason;
    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      request.reject(new HermesUnavailableError(reason));
    }
    this.pending.clear();
  }
}
