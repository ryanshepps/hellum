import { afterEach, describe, expect, test } from "bun:test";
import type { AssistantEventEnvelope } from "@vellumai/assistant-api";
import { authedClient, openEventStream, pairDevice, startTestBridge, type EventStreamReader, type TestBridge } from "../support/test-bridge";

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const PDF = new TextEncoder().encode("%PDF-1.4 tiny");

let bridge: TestBridge | null = null;
let stream: EventStreamReader | null = null;

afterEach(async () => {
  stream?.close();
  await bridge?.dispose();
  bridge = null;
  stream = null;
});

async function start() {
  bridge = await startTestBridge();
  const token = await pairDevice(bridge);
  stream = await openEventStream(bridge, token);
  const target = bridge;
  const upload = async (bytes: Uint8Array, filename: string, mimeType: string) => {
    const form = new FormData();
    form.set("file", new Blob([bytes], { type: mimeType }), filename);
    form.set("filename", filename);
    form.set("mimeType", mimeType);
    const response = await target.request("/v1/assistants/self/attachments", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
    return { status: response.status, body: (await response.json()) as { id: string; kind: string; sizeBytes: number } };
  };
  return { api: authedClient(bridge, token), events: stream, upload, token };
}

function completed(conversationId: string): (envelope: AssistantEventEnvelope) => boolean {
  return (envelope) => envelope.message.type === "message_complete" && envelope.conversationId === conversationId;
}

describe("attachments", () => {
  test("images reach Hermes as images and documents as file references", async () => {
    const { api, events, upload } = await start();
    const image = await upload(PNG, "photo.png", "image/png");
    const pdf = await upload(PDF, "report.pdf", "application/pdf");
    expect(image).toMatchObject({ status: 200, body: { kind: "image", sizeBytes: PNG.byteLength } });
    expect(pdf.body.kind).toBe("document");

    const sent = (await (
      await api.send("POST", "messages", {
        content: "look",
        attachmentIds: [image.body.id, pdf.body.id],
        sourceChannel: "vellum",
        interface: "ios",
      })
    ).json()) as { conversationId: string };
    const received = await events.until(completed(sent.conversationId));
    const reply = received
      .flatMap((envelope) => (envelope.message.type === "assistant_text_delta" && envelope.conversationId === sent.conversationId ? [envelope.message.text] : []))
      .join("");
    expect(reply).toBe("echo: look\n\n@file:uploads/report.pdf [images:1]");
  });

  test("the transcript shows the files on the user message without the staged references", async () => {
    const { api, events, upload } = await start();
    const image = await upload(PNG, "photo.png", "image/png");
    const pdf = await upload(PDF, "report.pdf", "application/pdf");
    const sent = (await (
      await api.send("POST", "messages", { content: "look", attachmentIds: [image.body.id, pdf.body.id], sourceChannel: "vellum", interface: "ios" })
    ).json()) as { conversationId: string };
    await events.until(completed(sent.conversationId));

    const snapshot = (await (await api.get(`messages?conversationId=${sent.conversationId}`)).json()) as {
      messages: { role: string; textSegments?: string[]; attachments: { id: string; data?: string; fileBacked?: boolean }[] }[];
    };
    const user = snapshot.messages.find((message) => message.role === "user");
    expect(user?.textSegments).toEqual(["look"]);
    expect(user?.attachments.map((attachment) => attachment.id)).toEqual([image.body.id, pdf.body.id]);
    expect(user?.attachments[0]?.data).toBe(Buffer.from(PNG).toString("base64"));
    expect(user?.attachments[1]?.data).toBeUndefined();
  });

  test("an attachment can be downloaded, listed, and is removed with its conversation", async () => {
    const { api, events, upload } = await start();
    const pdf = await upload(PDF, "report.pdf", "application/pdf");
    const sent = (await (
      await api.send("POST", "messages", { content: "", attachmentIds: [pdf.body.id], sourceChannel: "vellum", interface: "ios" })
    ).json()) as { conversationId: string };
    await events.until(completed(sent.conversationId));

    const content = await api.get(`attachments/${pdf.body.id}/content`);
    expect(content.headers.get("Content-Type")).toBe("application/pdf");
    expect(new Uint8Array(await content.arrayBuffer())).toEqual(PDF);
    const listed = (await (await api.get(`attachments?conversationId=${sent.conversationId}`)).json()) as { attachments: { id: string }[] };
    expect(listed.attachments.map((attachment) => attachment.id)).toEqual([pdf.body.id]);

    await api.send("DELETE", `conversations/${sent.conversationId}`);
    expect((await api.get(`attachments/${pdf.body.id}`)).status).toBe(404);
  });

  test("sending an unknown attachment is refused before anything reaches Hermes", async () => {
    const { api } = await start();
    const response = await api.send("POST", "messages", { content: "hi", attachmentIds: ["3f0f8a52-55d4-4a8b-9a3c-000000000000"], sourceChannel: "vellum", interface: "ios" });
    expect(response.status).toBe(400);
    const conversations = (await (await api.get("conversations")).json()) as { conversations: unknown[] };
    expect(conversations.conversations).toEqual([]);
  });
});
