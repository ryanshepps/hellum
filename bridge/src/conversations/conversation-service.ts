import type { ConversationMessage } from "@vellumai/assistant-api";
import { z } from "zod";
import type { EventHub } from "../events/event-hub";
import type { HermesGateway } from "../hermes/hermes-gateway";
import { parseTurnEvent, SessionListResultSchema, type SessionRow } from "../hermes/schemas";
import type { HermesEvent } from "../hermes/wire";
import { log } from "../log";
import { toConversationSummary, type ConversationActivity, type ConversationSummary } from "../translate/conversations";
import { historyToMessages } from "../translate/history";
import { userMessageId } from "../translate/message-ids";
import { resolveApproval, startTurn, translateTurnEvent, type TranslatedTurn, type TurnState } from "../translate/turn-translator";
import {
  withActivity,
  withArchived,
  withoutConversation,
  type ConversationState,
  type ConversationStore,
} from "./conversation-store";
import { LiveSessions } from "./live-sessions";

const SESSION_SCAN_LIMIT = 500;
const TitleResultSchema = z.object({ title: z.string() });

export type ArchiveFilter = "active" | "archived" | "all";

export type ConversationPage = {
  readonly conversations: readonly ConversationSummary[];
  readonly hasMore: boolean;
  readonly nextOffset: number;
};

export type SentMessage = {
  readonly conversationId: string;
  readonly messageId: string;
};

export type Snapshot = {
  readonly messages: readonly ConversationMessage[];
  readonly processing: boolean;
};

export class ConversationNotFoundError extends Error {
  constructor(conversationId: string) {
    super(`No conversation ${conversationId}`);
    this.name = "ConversationNotFoundError";
  }
}

export class ConversationService {
  private readonly live: LiveSessions;
  private readonly turns = new Map<string, TurnState>();
  private readonly processing = new Set<string>();

  private constructor(
    private readonly gateway: HermesGateway,
    private readonly hub: EventHub,
    private readonly store: ConversationStore,
    private state: ConversationState,
  ) {
    this.live = new LiveSessions(gateway);
    gateway.onEvent((event) => this.handleHermesEvent(event));
    gateway.onDisconnect((reason) => this.handleDisconnect(reason));
  }

  static async open(gateway: HermesGateway, hub: EventHub, store: ConversationStore): Promise<ConversationService> {
    return new ConversationService(gateway, hub, store, await store.load());
  }

  async list(offset: number, limit: number, filter: ArchiveFilter): Promise<ConversationPage> {
    const matching = (await this.summaries()).filter((summary) => {
      const archived = summary.archivedAt !== undefined;
      return filter === "all" || (filter === "archived" ? archived : !archived);
    });
    const ordered = matching.toSorted((left, right) => (right.lastMessageAt ?? right.createdAt) - (left.lastMessageAt ?? left.createdAt));
    const page = ordered.slice(offset, offset + limit);
    return { conversations: page, hasMore: offset + limit < ordered.length, nextOffset: offset + page.length };
  }

  async get(conversationId: string): Promise<ConversationSummary> {
    const summary = (await this.summaries()).find((candidate) => candidate.id === conversationId);
    if (!summary) {
      throw new ConversationNotFoundError(conversationId);
    }
    return summary;
  }

  async snapshot(conversationId: string): Promise<Snapshot> {
    const row = await this.findRow(conversationId);
    const history = await this.live.history(conversationId);
    return {
      messages: historyToMessages(conversationId, Math.round(row.started_at * 1000), history),
      processing: this.processing.has(conversationId),
    };
  }

  async send(conversationId: string | null, text: string, clientMessageId: string | undefined): Promise<SentMessage> {
    const live = conversationId ? await this.live.open(conversationId) : await this.live.create();
    const turn = this.live.claimTurn(live.conversationId);
    const messageId = userMessageId(live.conversationId, turn);
    this.turns.set(live.conversationId, startTurn(live.conversationId, turn, this.turns.get(live.conversationId) ?? null));
    this.processing.add(live.conversationId);
    this.hub.publish({
      type: "user_message_echo",
      text,
      conversationId: live.conversationId,
      messageId,
      ...(clientMessageId ? { clientMessageId } : {}),
    });
    await this.recordActivity(live.conversationId);
    try {
      await this.gateway.request("prompt.submit", { session_id: live.sid, text }, z.object({ status: z.string() }).passthrough());
    } catch (error) {
      this.applyTurn(live.conversationId, (turnState) =>
        translateTurnEvent(turnState, { type: "error", message: error instanceof Error ? error.message : String(error) }, Date.now()),
      );
      this.processing.delete(live.conversationId);
      throw error;
    }
    return { conversationId: live.conversationId, messageId };
  }

  async cancel(conversationId: string): Promise<boolean> {
    const live = this.live.get(conversationId);
    if (!live || !this.processing.has(conversationId)) {
      return false;
    }
    await this.gateway.request("session.interrupt", { session_id: live.sid }, z.unknown());
    return true;
  }

  async confirm(requestId: string, decision: "allow" | "deny"): Promise<boolean> {
    const entry = [...this.turns.entries()].find(([, turnState]) => turnState.pendingApproval?.requestId === requestId);
    const live = entry ? this.live.get(entry[0]) : null;
    if (!entry || !live) {
      return false;
    }
    await this.gateway.request("approval.respond", { session_id: live.sid, choice: decision === "allow" ? "once" : "deny" }, z.unknown());
    this.applyTurn(entry[0], (turnState) => resolveApproval(turnState, decision === "allow" ? "approved" : "rejected"));
    return true;
  }

  async rename(conversationId: string, title: string): Promise<void> {
    const live = await this.live.open(conversationId);
    await this.gateway.request("session.title", { session_id: live.sid, title }, TitleResultSchema.passthrough());
    this.hub.publish({ type: "conversation_title_updated", conversationId, title });
  }

  async delete(conversationId: string): Promise<void> {
    const live = this.live.get(conversationId);
    if (live) {
      await this.gateway.request("session.close", { session_id: live.sid }, z.unknown());
      this.live.forget(conversationId);
    }
    await this.gateway.request("session.delete", { session_id: conversationId }, z.unknown());
    this.turns.delete(conversationId);
    this.processing.delete(conversationId);
    await this.updateState((state) => withoutConversation(state, conversationId));
  }

  async setArchived(conversationId: string, archived: boolean): Promise<void> {
    await this.findRow(conversationId);
    await this.updateState((state) => withArchived(state, conversationId, archived ? Date.now() : null));
  }

  private async summaries(): Promise<readonly ConversationSummary[]> {
    const { sessions } = await this.gateway.request("session.list", { limit: SESSION_SCAN_LIMIT }, SessionListResultSchema);
    const activity: ConversationActivity = {
      lastActivityAt: new Map(Object.entries(this.state.lastActivityAt)),
      archivedAt: new Map(Object.entries(this.state.archivedAt)),
      processing: this.processing,
    };
    return sessions.map((row) => toConversationSummary(row, activity));
  }

  private async findRow(conversationId: string): Promise<SessionRow> {
    const { sessions } = await this.gateway.request("session.list", { limit: SESSION_SCAN_LIMIT }, SessionListResultSchema);
    const row = sessions.find((candidate) => candidate.id === conversationId);
    if (!row) {
      throw new ConversationNotFoundError(conversationId);
    }
    return row;
  }

  private handleHermesEvent(event: HermesEvent): void {
    const conversationId = event.sessionId ? this.live.conversationFor(event.sessionId) : null;
    const turnEvent = parseTurnEvent(event.type, event.payload);
    if (!conversationId || !turnEvent) {
      return;
    }
    this.applyTurn(conversationId, (turnState) => translateTurnEvent(turnState, turnEvent, Date.now()));
    if (turnEvent.type === "message.complete" || turnEvent.type === "error") {
      this.processing.delete(conversationId);
      void this.afterTurn(conversationId);
    }
  }

  private handleDisconnect(reason: string): void {
    for (const conversationId of this.processing) {
      this.applyTurn(conversationId, (turnState) => translateTurnEvent(turnState, { type: "error", message: `Hermes stopped: ${reason}` }, Date.now()));
    }
    this.processing.clear();
    this.live.clear();
  }

  private applyTurn(conversationId: string, step: (state: TurnState) => TranslatedTurn): void {
    const current = this.turns.get(conversationId) ?? startTurn(conversationId, 0, null);
    const { state, events } = step(current);
    this.turns.set(conversationId, state);
    for (const assistantEvent of events) {
      this.hub.publish(assistantEvent);
    }
  }

  private async afterTurn(conversationId: string): Promise<void> {
    try {
      await this.recordActivity(conversationId);
      const live = this.live.get(conversationId);
      if (!live) {
        return;
      }
      const { title } = await this.gateway.request("session.title", { session_id: live.sid }, TitleResultSchema.passthrough());
      if (title.trim()) {
        this.hub.publish({ type: "conversation_title_updated", conversationId, title });
      }
    } catch (error) {
      log.warn("could not refresh conversation after turn", { conversationId, error: error instanceof Error ? error.message : String(error) });
    }
  }

  private recordActivity(conversationId: string): Promise<void> {
    return this.updateState((state) => withActivity(state, conversationId, Date.now()));
  }

  private updateState(change: (state: ConversationState) => ConversationState): Promise<void> {
    this.state = change(this.state);
    return this.store.save(this.state);
  }
}
