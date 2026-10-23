import { expect } from "bun:test";
import type { AssistantEventEnvelope } from "@vellumai/assistant-api";
import type { AuthedClient } from "./test-bridge";

export type Sent = { readonly accepted: boolean; readonly conversationId: string; readonly messageId: string };

export async function sendMessage(api: AuthedClient, content: string, conversationId?: string): Promise<Sent> {
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

export function isType(type: string, conversationId?: string): (envelope: AssistantEventEnvelope) => boolean {
  return (envelope) => envelope.message.type === type && (!conversationId || envelope.conversationId === conversationId);
}
