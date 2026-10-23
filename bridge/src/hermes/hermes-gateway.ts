import type { z } from "zod";
import { log } from "../log";
import type { GatewayCommand } from "./gateway-process";
import { HermesRpcPeer, HermesUnavailableError, type EventListener, type LineTransport } from "./rpc-peer";
import type { RpcParams } from "./wire";

export type SpawnTransport = (command: GatewayCommand) => LineTransport;

const READY_TIMEOUT_MS = 60_000;
const MAX_RESTART_DELAY_MS = 30_000;

export class HermesGateway {
  private peer: HermesRpcPeer | null = null;
  private starting: Promise<HermesRpcPeer> | null = null;
  private launchAttempts = 0;
  private stopped = false;
  private readonly eventListeners = new Set<EventListener>();
  private readonly disconnectListeners = new Set<(reason: string) => void>();

  constructor(
    private readonly command: GatewayCommand,
    private readonly spawn: SpawnTransport,
  ) {}

  onEvent(listener: EventListener): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  onDisconnect(listener: (reason: string) => void): () => void {
    this.disconnectListeners.add(listener);
    return () => this.disconnectListeners.delete(listener);
  }

  async start(): Promise<void> {
    await this.ensurePeer();
  }

  async request<T>(method: string, params: RpcParams, schema: z.ZodType<T>, timeoutMs?: number): Promise<T> {
    const peer = await this.ensurePeer();
    return peer.request(method, params, schema, timeoutMs);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    const peer = this.peer;
    this.peer = null;
    await peer?.close();
  }

  private ensurePeer(): Promise<HermesRpcPeer> {
    if (this.stopped) {
      return Promise.reject(new HermesUnavailableError("bridge is shutting down"));
    }
    if (this.peer && !this.peer.isClosed) {
      return Promise.resolve(this.peer);
    }
    this.starting ??= this.launch().finally(() => {
      this.starting = null;
    });
    return this.starting;
  }

  private async launch(): Promise<HermesRpcPeer> {
    if (this.launchAttempts > 0) {
      const delay = Math.min(MAX_RESTART_DELAY_MS, 500 * 2 ** (this.launchAttempts - 1));
      await Bun.sleep(delay);
    }
    this.launchAttempts += 1;
    const transport = this.spawn(this.command);
    transport.onClose((reason) => {
      if (this.stopped) {
        return;
      }
      for (const listener of this.disconnectListeners) {
        listener(reason);
      }
    });
    const peer = new HermesRpcPeer(transport);
    peer.onEvent((event) => {
      for (const listener of this.eventListeners) {
        listener(event);
      }
    });
    const ready = await Promise.race([peer.ready.then(() => true), Bun.sleep(READY_TIMEOUT_MS).then(() => false)]);
    if (!ready || peer.isClosed) {
      await peer.close();
      throw new HermesUnavailableError("the Hermes gateway did not start");
    }
    log.info("hermes gateway ready", { launchAttempts: this.launchAttempts });
    this.peer = peer;
    this.launchAttempts = 1;
    return peer;
  }
}
