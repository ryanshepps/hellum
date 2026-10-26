import { HistoryResultSchema, SessionOpenResultSchema, type HistoryMessage } from "../hermes/schemas";
import type { HermesGateway } from "../hermes/hermes-gateway";
import { userTurnCount } from "../translate/history";

export type LiveSession = {
  readonly conversationId: string;
  readonly sid: string;
  readonly nextTurn: number;
};

export const SESSION_SOURCE = "hellum";

export class LiveSessions {
  private readonly byConversation = new Map<string, LiveSession>();
  private readonly conversationBySid = new Map<string, string>();
  private readonly opening = new Map<string, Promise<LiveSession>>();

  constructor(private readonly gateway: HermesGateway) {}

  conversationFor(sid: string): string | null {
    return this.conversationBySid.get(sid) ?? null;
  }

  get(conversationId: string): LiveSession | null {
    return this.byConversation.get(conversationId) ?? null;
  }

  openConversations(): readonly string[] {
    return [...this.byConversation.keys()];
  }

  clear(): void {
    this.byConversation.clear();
    this.conversationBySid.clear();
    this.opening.clear();
  }

  async create(): Promise<LiveSession> {
    const opened = await this.gateway.request("session.create", { source: SESSION_SOURCE }, SessionOpenResultSchema);
    if (!opened.stored_session_id) {
      throw new Error("Hermes created a session without a stored id");
    }
    return this.remember({ conversationId: opened.stored_session_id, sid: opened.session_id, nextTurn: 0 });
  }

  open(conversationId: string): Promise<LiveSession> {
    const live = this.byConversation.get(conversationId);
    if (live) {
      return Promise.resolve(live);
    }
    const pending =
      this.opening.get(conversationId) ??
      this.resume(conversationId).finally(() => {
        this.opening.delete(conversationId);
      });
    this.opening.set(conversationId, pending);
    return pending;
  }

  async history(conversationId: string): Promise<readonly HistoryMessage[]> {
    const live = await this.open(conversationId);
    const result = await this.gateway.request("session.history", { session_id: live.sid }, HistoryResultSchema);
    return result.messages;
  }

  claimTurn(conversationId: string, recordedTurns: number, turnInFlight: boolean): number {
    const live = this.byConversation.get(conversationId);
    if (!live) {
      throw new Error(`Conversation ${conversationId} is not open`);
    }
    const turn = turnInFlight ? Math.max(recordedTurns, live.nextTurn) : recordedTurns;
    this.byConversation.set(conversationId, { ...live, nextTurn: turn + 1 });
    return turn;
  }

  forget(conversationId: string): void {
    const live = this.byConversation.get(conversationId);
    if (live) {
      this.conversationBySid.delete(live.sid);
    }
    this.byConversation.delete(conversationId);
  }

  private async resume(conversationId: string): Promise<LiveSession> {
    const opened = await this.gateway.request("session.resume", { session_id: conversationId }, SessionOpenResultSchema);
    const history = await this.gateway.request("session.history", { session_id: opened.session_id }, HistoryResultSchema);
    return this.remember({ conversationId, sid: opened.session_id, nextTurn: userTurnCount(history.messages) });
  }

  private remember(live: LiveSession): LiveSession {
    this.byConversation.set(live.conversationId, live);
    this.conversationBySid.set(live.sid, live.conversationId);
    return live;
  }
}
