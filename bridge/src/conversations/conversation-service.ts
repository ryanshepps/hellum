import type { ConversationMessage } from "@vellumai/assistant-api";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { AttachmentStore } from "../attachments/attachment-store";
import { resolveAttachments, stageAttachments } from "../attachments/attachment-stager";
import { attachmentsByMessage, messageAttachmentView } from "../attachments/attachment-views";
import type { EventHub } from "../events/event-hub";
import type { HermesGateway } from "../hermes/hermes-gateway";
import { runHermesHelper, type HelperCommand } from "../hermes/helper-process";
import { HermesRpcError } from "../hermes/rpc-peer";
import { parseServerPrompt, parseTurnEvent, type SessionRow } from "../hermes/schemas";
import type { HermesEvent, ServerRequest } from "../hermes/wire";
import { log } from "../log";
import { toConversationSummary, type ConversationActivity, type ConversationSummary } from "../translate/conversations";
import { historyToMessages, userTurnCount, type OriginalTimes } from "../translate/history";
import { foldLiveTurn, mergeLiveTurn, openLiveTurn, type LiveTurn } from "../translate/live-turn";
import { decorateUserMessages, promptWithFileRefs } from "../translate/message-attachments";
import { assistantMessageId, userMessageId } from "../translate/message-ids";
import { promptReply } from "../translate/prompt-surfaces";
import { resolveApproval, resolvePrompt, startTurn, translateTurnEvent, type TranslatedTurn, type TurnState } from "../translate/turn-translator";
import {
  withActivity,
  withArchived,
  withoutConversation,
  withPromptText,
  type ConversationState,
  type ConversationStore,
} from "./conversation-store";
import { LiveSessions, type LiveSession } from "./live-sessions";
import { SessionCatalog } from "./session-catalog";

type Fence = "revision" | "execution_generation";
const MessageTimesResultSchema = z.object({ success: z.literal(true), times: z.record(z.string(), z.number()) });

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

export type PendingInteractions = {
  readonly pendingConfirmation?: object;
  readonly interactions: readonly {
    readonly requestId: string;
    readonly conversationId: string;
    readonly kind: "confirmation";
    readonly toolName: string;
    readonly riskLevel: string;
  }[];
};

export class ConversationNotFoundError extends Error {
  constructor(conversationId: string) {
    super(`No conversation ${conversationId}`);
    this.name = "ConversationNotFoundError";
  }
}

export class ConversationService {
  private readonly live: LiveSessions;
  private readonly catalog: SessionCatalog;
  private readonly turns = new Map<string, TurnState>();
  private readonly liveTurns = new Map<string, LiveTurn>();
  private readonly processing = new Set<string>();

  private constructor(
    private readonly gateway: HermesGateway,
    private readonly hub: EventHub,
    private readonly store: ConversationStore,
    private readonly attachments: AttachmentStore,
    private readonly helpers: HelperCommand,
    private state: ConversationState,
  ) {
    this.live = new LiveSessions(gateway);
    this.catalog = new SessionCatalog(helpers);
    gateway.onEvent((event) => this.handleHermesEvent(event));
    gateway.onServerRequest((request) => this.handleServerRequest(request));
    gateway.onDisconnect((reason) => this.handleDisconnect(reason));
  }

  static async open(
    gateway: HermesGateway,
    hub: EventHub,
    store: ConversationStore,
    attachments: AttachmentStore,
    helpers: HelperCommand,
  ): Promise<ConversationService> {
    return new ConversationService(gateway, hub, store, attachments, helpers, await store.load());
  }

  async releaseIdleSessions(): Promise<void> {
    const idle = this.live.openConversations().filter((conversationId) => !this.processing.has(conversationId));
    await Promise.all(
      idle.map((conversationId) => this.live.detach(conversationId).catch(() => undefined)),
    );
  }

  sessionRows(): Promise<readonly SessionRow[]> {
    return this.catalog.rows();
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
    const row = await this.catalog.find(conversationId);
    if (!row && !this.live.get(conversationId)) {
      return { messages: [], processing: false };
    }
    const [history, originalTimes] = await Promise.all([this.live.history(conversationId), this.originalTimes(conversationId)]);
    const startedAtMs = row ? Math.round(row.started_at * 1000) : Date.now();
    const messages = mergeLiveTurn(historyToMessages(conversationId, startedAtMs, history, originalTimes), this.liveTurns.get(conversationId) ?? null);
    return {
      messages: decorateUserMessages(messages, await attachmentsByMessage(this.attachments, messages), this.state.promptTexts),
      processing: this.processing.has(conversationId),
    };
  }

  private async originalTimes(conversationId: string): Promise<OriginalTimes> {
    try {
      const { times } = await runHermesHelper(this.helpers, "sessions", { action: "message_times", session_id: conversationId }, MessageTimesResultSchema);
      return new Map(Object.entries(times).map(([rowId, at]) => [Number(rowId), Math.round(at * 1000)]));
    } catch (error) {
      log.warn("message times unavailable", { conversationId, error: error instanceof Error ? error.message : String(error) });
      return new Map();
    }
  }

  async send(
    conversationId: string | null,
    text: string,
    clientMessageId: string | undefined,
    attachmentIds: readonly string[],
  ): Promise<SentMessage> {
    const attached = resolveAttachments(this.attachments, attachmentIds);
    const live = conversationId && (await this.isKnown(conversationId)) ? await this.live.open(conversationId) : await this.createSession();
    const staged = await stageAttachments(this.gateway, this.attachments, live.sid, attached);
    const recordedTurns = userTurnCount(await this.live.history(live.conversationId));
    const turn = this.live.claimTurn(live.conversationId, recordedTurns, this.processing.has(live.conversationId));
    const messageId = userMessageId(live.conversationId, turn);
    await this.attachments.link(attachmentIds, live.conversationId, messageId);
    if (attached.length > 0) {
      await this.updateState((state) => withPromptText(state, messageId, text));
    }
    const attachmentViews = await Promise.all(attached.map((attachment) => messageAttachmentView(this.attachments, attachment)));
    this.turns.set(live.conversationId, startTurn(live.conversationId, turn, this.turns.get(live.conversationId) ?? null));
    this.processing.add(live.conversationId);
    this.liveTurns.set(
      live.conversationId,
      openLiveTurn(messageId, assistantMessageId(live.conversationId, turn), clientMessageId, text, attachmentViews, Date.now()),
    );
    this.hub.publish({
      type: "user_message_echo",
      text,
      conversationId: live.conversationId,
      messageId,
      ...(clientMessageId ? { clientMessageId } : {}),
    });
    await this.recordActivity(live.conversationId);
    try {
      await this.gateway.request(
        "prompt.submit",
        { session_id: live.sid, submission_id: randomUUID(), text: promptWithFileRefs(text, staged.fileRefs) },
        z.object({ status: z.string() }).passthrough(),
      );
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
    const known = (await this.catalog.find(conversationId))?.runtime_generation ?? 0;
    await this.fenced("execution_generation", known, (generation) =>
      this.gateway.request("session.interrupt", { session_id: live.sid, execution_generation: generation }, z.unknown()),
    );
    return true;
  }

  async confirm(requestId: string, decision: "allow" | "deny"): Promise<boolean> {
    const entry = [...this.turns.entries()].find(([, turnState]) => turnState.pendingApproval?.requestId === requestId);
    const live = entry ? this.live.get(entry[0]) : null;
    if (!entry || !live) {
      return false;
    }
    const { control } = entry[1].pendingApproval ?? {};
    if (!control) {
      return false;
    }
    await this.gateway.request(
      "approval.respond",
      { session_id: live.sid, execution_generation: control.generation, prompt_id: control.promptId, choice: decision === "allow" ? "once" : "deny" },
      z.unknown(),
    );
    this.applyTurn(entry[0], (turnState) => resolveApproval(turnState, decision === "allow" ? "approved" : "rejected"));
    return true;
  }

  async surfaceAction(surfaceId: string, actionId: string, data: Readonly<Record<string, unknown>>): Promise<string | null> {
    const entry = [...this.turns.entries()].find(([, turnState]) => turnState.pendingPrompt?.surfaceId === surfaceId);
    const pending = entry?.[1].pendingPrompt;
    if (!entry || !pending) {
      return null;
    }
    const reply = promptReply(pending.prompt, actionId, data);
    if (reply.kind === "response") {
      this.gateway.respond(reply.requestId, { value: reply.value });
    } else {
      const live = this.live.get(entry[0]);
      if (!live) {
        return null;
      }
      await this.gateway.request(reply.method, { session_id: live.sid, ...reply.params }, z.unknown());
    }
    this.applyTurn(entry[0], (turnState) => resolvePrompt(turnState, reply.summary));
    return entry[0];
  }

  pendingInteractions(conversationId: string | null): PendingInteractions {
    const pending = [...this.turns.values()].flatMap((turnState) =>
      turnState.pendingApproval && (!conversationId || turnState.conversationId === conversationId)
        ? [turnState.pendingApproval.confirmation]
        : [],
    );
    const { type: _type, ...pendingConfirmation } = pending[0] ?? { type: null };
    return {
      ...(pending[0] ? { pendingConfirmation } : {}),
      interactions: pending.map((confirmation) => ({
        requestId: confirmation.requestId,
        conversationId: confirmation.conversationId ?? "",
        kind: "confirmation",
        toolName: confirmation.toolName,
        riskLevel: confirmation.riskLevel,
      })),
    };
  }

  async rename(conversationId: string, title: string): Promise<void> {
    await this.mutate(conversationId, "rename", { title });
    this.catalog.invalidate();
    this.hub.publish({ type: "conversation_title_updated", conversationId, title });
  }

  async delete(conversationId: string): Promise<void> {
    await this.live.detach(conversationId);
    await this.mutate(conversationId, "delete", {});
    this.catalog.invalidate();
    this.turns.delete(conversationId);
    this.liveTurns.delete(conversationId);
    this.processing.delete(conversationId);
    await this.attachments.removeConversation(conversationId);
    await this.updateState((state) => withoutConversation(state, conversationId));
  }

  async setArchived(conversationId: string, archived: boolean): Promise<void> {
    if (!(await this.isKnown(conversationId))) {
      throw new ConversationNotFoundError(conversationId);
    }
    await this.updateState((state) => withArchived(state, conversationId, archived ? Date.now() : null));
  }

  private async mutate(conversationId: string, operation: "rename" | "delete", payload: Readonly<Record<string, string>>): Promise<void> {
    this.catalog.invalidate();
    const known = (await this.catalog.find(conversationId))?.runtime_revision ?? 0;
    const requestId = randomUUID();
    await this.fenced("revision", known, (revision) =>
      this.gateway.request(
        "session.mutate",
        { session_id: conversationId, request_id: requestId, expected_revision: revision, operation, payload },
        z.unknown(),
      ),
    );
  }

  private async fenced<T>(fence: Fence, known: number, attempt: (value: number) => Promise<T>): Promise<T> {
    try {
      return await attempt(known);
    } catch (error) {
      const current = error instanceof HermesRpcError ? error.data[fence] : undefined;
      if (typeof current !== "number" || current === known) {
        throw error;
      }
      return attempt(current);
    }
  }

  private async summaries(): Promise<readonly ConversationSummary[]> {
    const activity: ConversationActivity = {
      lastActivityAt: new Map(Object.entries(this.state.lastActivityAt)),
      archivedAt: new Map(Object.entries(this.state.archivedAt)),
      processing: this.processing,
    };
    return (await this.catalog.rows()).map((row) => toConversationSummary(row, activity));
  }

  private async isKnown(conversationId: string): Promise<boolean> {
    return this.live.get(conversationId) !== null || (await this.catalog.find(conversationId)) !== null;
  }

  private async createSession(): Promise<LiveSession> {
    const created = await this.live.create();
    this.catalog.invalidate();
    return created;
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

  private handleServerRequest(request: ServerRequest): void {
    const asked = parseServerPrompt(request);
    const conversationId = asked ? this.live.conversationFor(asked.sessionId) : null;
    if (!asked || !conversationId) {
      log.warn("unanswered request from hermes", { method: request.method });
      return;
    }
    this.applyTurn(conversationId, (turnState) => translateTurnEvent(turnState, { type: "prompt.request", prompt: asked.prompt }, Date.now()));
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
      const liveTurn = this.liveTurns.get(conversationId);
      if (liveTurn) {
        this.liveTurns.set(conversationId, foldLiveTurn(liveTurn, assistantEvent));
      }
      this.hub.publish(assistantEvent);
    }
  }

  private async afterTurn(conversationId: string): Promise<void> {
    this.catalog.invalidate();
    try {
      await this.recordActivity(conversationId);
      const title = (await this.catalog.find(conversationId))?.title ?? "";
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
