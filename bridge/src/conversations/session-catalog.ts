import type { HermesGateway } from "../hermes/hermes-gateway";
import { SessionListResultSchema, type SessionRow } from "../hermes/schemas";

const SESSION_SCAN_LIMIT = 500;
const FRESH_FOR_MS = 3_000;

type Snapshot = { readonly rows: readonly SessionRow[]; readonly fetchedAt: number };

export class SessionCatalog {
  private snapshot: Snapshot | null = null;
  private inFlight: Promise<readonly SessionRow[]> | null = null;
  private generation = 0;

  constructor(
    private readonly gateway: HermesGateway,
    private readonly now: () => number = Date.now,
  ) {}

  rows(): Promise<readonly SessionRow[]> {
    if (this.snapshot && this.now() - this.snapshot.fetchedAt < FRESH_FOR_MS) {
      return Promise.resolve(this.snapshot.rows);
    }
    this.inFlight ??= this.fetch().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  async find(conversationId: string): Promise<SessionRow | null> {
    return (await this.rows()).find((row) => row.id === conversationId) ?? null;
  }

  invalidate(): void {
    this.generation += 1;
    this.snapshot = null;
    this.inFlight = null;
  }

  private async fetch(): Promise<readonly SessionRow[]> {
    const generation = this.generation;
    const { sessions } = await this.gateway.request("session.list", { limit: SESSION_SCAN_LIMIT }, SessionListResultSchema);
    if (generation === this.generation) {
      this.snapshot = { rows: sessions, fetchedAt: this.now() };
    }
    return sessions;
  }
}
