import { afterEach, describe, expect, test } from "bun:test";
import { AssistantEventEnvelopeSchema, ConversationMessageSchema, type AssistantEventEnvelope } from "@vellumai/assistant-api";
import { authedClient, openEventStream, pairDevice, startTestBridge, type AuthedClient, type EventStreamReader, type TestBridge } from "../support/test-bridge";

let bridge: TestBridge | null = null;
let stream: EventStreamReader | null = null;

afterEach(async () => {
  stream?.close();
  stream = null;
  await bridge?.dispose();
  bridge = null;
});

type Started = { readonly api: AuthedClient; readonly events: EventStreamReader; readonly target: TestBridge };

async function start(): Promise<Started> {
  bridge = await startTestBridge();
  const token = await pairDevice(bridge);
  stream = await openEventStream(bridge, token);
  return { api: authedClient(bridge, token), events: stream, target: bridge };
}

type Sent = { readonly accepted: boolean; readonly conversationId: string; readonly messageId: string };

async function sendMessage(api: AuthedClient, content: string, conversationId?: string): Promise<Sent> {
  const response = await api.send("POST", "messages", {
    content,
    sourceChannel: "vellum",
    interface: "web",
    clientMessageId: "client-1",
    ...(conversationId ? { conversationId } : {}),
  });
  expect(response.status).toBe(202);
  return (await response.json()) as Sent;
}

function isType(type: string, conversationId?: string): (envelope: AssistantEventEnvelope) => boolean {
  return (envelope) => envelope.message.type === type && (!conversationId || envelope.conversationId === conversationId);
}

describe("sending a message", () => {
  test("a first message creates a conversation and streams the reply", async () => {
    const { api, events } = await start();
    const sent = await sendMessage(api, "hi there");
    expect(sent).toEqual({ accepted: true, conversationId: "fake_1", messageId: "fake_1:u0" });

    const received = await events.until(isType("message_complete", sent.conversationId));
    const types = received.map((envelope) => envelope.message.type);
    expect(types[0]).toBe("user_message_echo");
    expect(types).toContain("assistant_turn_start");
    expect(types).toContain("assistant_text_delta");
    expect(received[0]?.message).toMatchObject({ text: "hi there", messageId: "fake_1:u0", clientMessageId: "client-1" });
    for (const envelope of received) {
      expect(AssistantEventEnvelopeSchema.safeParse(envelope).success).toBe(true);
    }
    const seqs = received.map((envelope) => envelope.seq ?? 0);
    expect(seqs).toEqual(seqs.toSorted((left, right) => left - right));
  });

  test("the transcript snapshot reflects the finished turn with matching ids", async () => {
    const { api, events } = await start();
    const sent = await sendMessage(api, "hi there");
    await events.until(isType("message_complete", sent.conversationId));

    const response = await api.get(`messages?conversationId=${sent.conversationId}`);
    const body = (await response.json()) as { messages: unknown[]; seq: number; processing: boolean };
    expect(body.processing).toBe(false);
    expect(body.messages.map((message) => ConversationMessageSchema.parse(message).id)).toEqual(["fake_1:u0", "fake_1:a0"]);
    expect(body.messages[1]).toMatchObject({ contentBlocks: [{ type: "text", text: "echo: hi there" }] });
  });

  test("a follow-up continues the turn numbering", async () => {
    const { api, events } = await start();
    const first = await sendMessage(api, "one");
    await events.until(isType("message_complete", first.conversationId));
    const second = await sendMessage(api, "two", first.conversationId);
    expect(second.messageId).toBe("fake_1:u1");
    const received = await events.until((envelope) => isType("message_complete")(envelope) && envelope.message.type === "message_complete" && envelope.message.messageId === "fake_1:a1");
    expect(received.at(-2)?.message.type).toBe("message_complete");
  });

  test("the generated title is announced after the first turn", async () => {
    const { api, events } = await start();
    const sent = await sendMessage(api, "plan a trip");
    const received = await events.until(isType("conversation_title_updated", sent.conversationId));
    expect(received.find(isType("conversation_title_updated"))?.message).toMatchObject({ title: "About plan a trip" });
  });

  test("an empty message is refused", async () => {
    const { api } = await start();
    const response = await api.send("POST", "messages", { content: "  ", sourceChannel: "vellum", interface: "web" });
    expect(response.status).toBe(400);
  });
});

describe("draft conversations", () => {
  const DRAFT_ID = "1c9c1991-2751-4e8c-88a0-e07c7f736440";

  test("a draft id the client minted has an empty transcript and no conversation yet", async () => {
    const { api } = await start();
    const messages = await api.get(`messages?conversationId=${DRAFT_ID}`);
    expect(messages.status).toBe(200);
    expect(((await messages.json()) as { messages: unknown[] }).messages).toEqual([]);
    expect((await api.get(`conversations/${DRAFT_ID}`)).status).toBe(404);
  });

  test("sending to a draft id starts a new Hermes conversation", async () => {
    const { api, events } = await start();
    const sent = await sendMessage(api, "first words", DRAFT_ID);
    expect(sent.conversationId).not.toBe(DRAFT_ID);
    await events.until(isType("message_complete", sent.conversationId));
  });
});

describe("tool approvals", () => {
  test("a confirmation pauses the turn until the device decides", async () => {
    const { api, events } = await start();
    const sent = await sendMessage(api, "trace:approval");
    const received = await events.until(isType("confirmation_request", sent.conversationId));
    const confirmation = received.find(isType("confirmation_request"))?.message;
    if (confirmation?.type !== "confirmation_request") throw new Error("expected a confirmation");

    const pending = (await (await api.get(`pending-interactions?conversationId=${sent.conversationId}`)).json()) as {
      pendingConfirmation?: { requestId: string; input: object };
      interactions: object[];
    };
    expect(pending.pendingConfirmation).toMatchObject({ requestId: confirmation.requestId, input: { command: "rm -rf ./hellum-nonexistent-dir" } });
    expect(pending.interactions).toHaveLength(1);

    const decided = await api.send("POST", "confirm", { requestId: confirmation.requestId, decision: "deny" });
    expect(await decided.json()).toEqual({ accepted: true });
    const after = await events.until(isType("message_complete", sent.conversationId));
    expect(after.some((envelope) => envelope.message.type === "interaction_resolved" && envelope.message.state === "rejected")).toBe(true);
    expect(await (await api.get(`pending-interactions?conversationId=${sent.conversationId}`)).json()).toEqual({ interactions: [] });
  });

  test("an unknown confirmation is not accepted", async () => {
    const { api } = await start();
    const response = await api.send("POST", "confirm", { requestId: "nope", decision: "allow" });
    expect(await response.json()).toEqual({ accepted: false });
  });
});

describe("conversation management", () => {
  test("conversations are listed newest first and can be renamed, archived, and deleted", async () => {
    const { api, events } = await start();
    const first = await sendMessage(api, "first");
    await events.until(isType("message_complete", first.conversationId));
    const second = await sendMessage(api, "second");
    await events.until(isType("message_complete", second.conversationId));

    const listed = (await (await api.get("conversations?limit=10&offset=0")).json()) as { conversations: { id: string }[]; hasMore: boolean };
    expect(listed.conversations.map((conversation) => conversation.id)).toEqual([second.conversationId, first.conversationId]);
    expect(listed.hasMore).toBe(false);

    expect((await api.send("PATCH", `conversations/${first.conversationId}/name`, { name: "Renamed" })).status).toBe(200);
    const fetched = (await (await api.get(`conversations/${first.conversationId}`)).json()) as { conversation: { title: string } };
    expect(fetched.conversation.title).toBe("Renamed");

    expect((await api.send("POST", `conversations/${first.conversationId}/archive`)).status).toBe(200);
    const active = (await (await api.get("conversations")).json()) as { conversations: { id: string }[] };
    expect(active.conversations.map((conversation) => conversation.id)).toEqual([second.conversationId]);
    const archived = (await (await api.get("conversations?archiveStatus=archived")).json()) as { conversations: { id: string }[] };
    expect(archived.conversations.map((conversation) => conversation.id)).toEqual([first.conversationId]);

    expect((await api.send("DELETE", `conversations/${second.conversationId}`)).status).toBe(200);
    expect((await api.get(`conversations/${second.conversationId}`)).status).toBe(404);
  });

  test("cancelling a running turn ends it as cancelled", async () => {
    const { api, events } = await start();
    const sent = await sendMessage(api, "trace:approval");
    await events.until(isType("confirmation_request", sent.conversationId));
    const response = await api.send("POST", `conversations/${sent.conversationId}/cancel`);
    expect(await response.json()).toMatchObject({ cancelled: true });
    await events.until(isType("generation_cancelled", sent.conversationId));
  });
});

describe("resilience", () => {
  test("a crashed Hermes ends the turn with an error and recovers for the next message", async () => {
    const { api, events } = await start();
    const first = await sendMessage(api, "hello");
    await events.until(isType("message_complete", first.conversationId));

    await api.send("POST", "messages", { content: "crash", conversationId: first.conversationId, sourceChannel: "vellum", interface: "web" });
    await events.until(isType("conversation_error", first.conversationId));

    const recovered = await api.send("POST", "messages", { content: "after", sourceChannel: "vellum", interface: "web" });
    expect(recovered.status).toBe(202);
  });

  test("a reconnecting client replays events it missed", async () => {
    const { api, events, target } = await start();
    const sent = await sendMessage(api, "hi");
    const received = await events.until(isType("message_complete", sent.conversationId));
    const cursor = received[2]?.seq ?? 0;
    const token = await pairDevice(target);
    const replay = await openEventStream(target, token, cursor);
    const replayed = await replay.until(isType("message_complete", sent.conversationId));
    replay.close();
    const throughCompletion = (envelopes: readonly AssistantEventEnvelope[]) =>
      envelopes.slice(0, envelopes.findIndex(isType("message_complete")) + 1).map((envelope) => envelope.seq);
    expect(throughCompletion(replayed)).toEqual(throughCompletion(received.slice(3)));
  });
});
