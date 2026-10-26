import { afterEach, describe, expect, test } from "bun:test";
import type { AssistantEventEnvelope } from "@vellumai/assistant-api";
import { isType, sendMessage } from "../support/chat";
import { authedClient, openEventStream, pairDevice, startTestBridge, type EventStreamReader, type TestBridge } from "../support/test-bridge";

let bridge: TestBridge | null = null;
let stream: EventStreamReader | null = null;

afterEach(async () => {
  stream?.close();
  stream = null;
  await bridge?.dispose();
  bridge = null;
});

async function start() {
  bridge = await startTestBridge();
  const token = await pairDevice(bridge);
  stream = await openEventStream(bridge, token);
  return { api: authedClient(bridge, token), events: stream };
}

type Shown = { surfaceId: string; surfaceType: string; data: Record<string, unknown> };

function shownSurface(received: readonly AssistantEventEnvelope[]): Shown {
  const event = received.find(isType("ui_surface_show"))?.message;
  if (event?.type !== "ui_surface_show") throw new Error("no surface shown");
  return event;
}

function replyText(received: readonly AssistantEventEnvelope[]): string {
  return received.flatMap((envelope) => (envelope.message.type === "assistant_text_delta" ? [envelope.message.text] : [])).join("");
}

describe("Hermes questions become cards", () => {
  test("a multiple-choice question is answered by picking an option", async () => {
    const { api, events } = await start();
    const sent = await sendMessage(api, "ask:Which city?|Paris,Tokyo");
    const surface = shownSurface(await events.until(isType("ui_surface_show")));
    expect(surface.surfaceType).toBe("choice");
    expect(surface.data).toMatchObject({ description: "Which city?", options: [{ id: "choice-0", title: "Paris" }, { id: "choice-1", title: "Tokyo" }] });

    const acted = await api.send("POST", "surface-actions", { conversationId: sent.conversationId, surfaceId: surface.surfaceId, actionId: "choice-1", data: { choiceTitle: "Tokyo" } });
    expect(await acted.json()).toEqual({ ok: true, applied: true, conversationId: sent.conversationId });

    const received = await events.until(isType("message_complete", sent.conversationId));
    expect(received.find(isType("ui_surface_complete"))?.message).toMatchObject({ surfaceId: surface.surfaceId, summary: "Tokyo" });
    expect(replyText(received)).toBe("you said: Tokyo");
  });

  test("an open question is answered through a form", async () => {
    const { api, events } = await start();
    const sent = await sendMessage(api, "ask:What should I call you?");
    const surface = shownSurface(await events.until(isType("ui_surface_show")));
    expect(surface.surfaceType).toBe("form");

    await api.send("POST", "surface-actions", { surfaceId: surface.surfaceId, actionId: "submit", data: { answer: " Ryan " } });
    expect(replyText(await events.until(isType("message_complete", sent.conversationId)))).toBe("you said: Ryan");
  });

  test("a secret never appears in the card's summary", async () => {
    const { api, events } = await start();
    const sent = await sendMessage(api, "secret:GITHUB_TOKEN");
    const surface = shownSurface(await events.until(isType("ui_surface_show")));
    expect(surface.data).toMatchObject({ fields: [{ id: "value", type: "password" }] });

    await api.send("POST", "surface-actions", { surfaceId: surface.surfaceId, actionId: "submit", data: { value: "ghp_supersecret" } });
    const received = await events.until(isType("message_complete", sent.conversationId));
    expect(JSON.stringify(received.find(isType("ui_surface_complete")))).not.toContain("ghp_supersecret");
    expect(replyText(received)).toBe("stored 15 characters");
  });

  test("a sudo password answers Hermes' request for it", async () => {
    const { api, events } = await start();
    const sent = await sendMessage(api, "sudo:");
    const surface = shownSurface(await events.until(isType("ui_surface_show")));
    expect(surface.data).toMatchObject({ fields: [{ id: "password", type: "password" }] });

    await api.send("POST", "surface-actions", { surfaceId: surface.surfaceId, actionId: "submit", data: { password: "hunter2" } });
    expect(replyText(await events.until(isType("message_complete", sent.conversationId)))).toBe("authenticated");
  });

  test("skipping a question answers Hermes with nothing", async () => {
    const { api, events } = await start();
    const sent = await sendMessage(api, "ask:Anything else?");
    const surface = shownSurface(await events.until(isType("ui_surface_show")));
    await api.send("POST", "surface-actions", { surfaceId: surface.surfaceId, actionId: "cancel" });
    const received = await events.until(isType("message_complete", sent.conversationId));
    expect(received.find(isType("ui_surface_complete"))?.message).toMatchObject({ summary: "Cancelled" });
    expect(replyText(received)).toBe("you said: (nothing)");
  });

  test("an open card survives a reload and shows as answered afterwards", async () => {
    const { api, events } = await start();
    const sent = await sendMessage(api, "ask:Which city?|Paris,Tokyo");
    const surface = shownSurface(await events.until(isType("ui_surface_show")));
    const surfacesIn = async () =>
      JSON.stringify(await (await api.get(`messages?conversationId=${sent.conversationId}`)).json());
    expect(await surfacesIn()).toContain(surface.surfaceId);

    await api.send("POST", "surface-actions", { surfaceId: surface.surfaceId, actionId: "choice-0" });
    await events.until(isType("ui_surface_complete"));
    expect(await surfacesIn()).toContain('"completionSummary":"Paris"');
  });

  test("acting on an unknown card is not applied", async () => {
    const { api } = await start();
    const acted = await api.send("POST", "surface-actions", { surfaceId: "nope", actionId: "submit" });
    expect(await acted.json()).toMatchObject({ ok: true, applied: false });
  });
});
