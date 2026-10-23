import type { ConversationMessage, ConversationMessageAttachment } from "@vellumai/assistant-api";

export function promptWithFileRefs(text: string, fileRefs: readonly string[]): string {
  if (fileRefs.length === 0) {
    return text;
  }
  const refs = fileRefs.join("\n");
  return text.trim() ? `${text}\n\n${refs}` : refs;
}

export type AttachmentsByMessage = ReadonlyMap<string, readonly ConversationMessageAttachment[]>;

export function decorateUserMessages(
  messages: readonly ConversationMessage[],
  attachments: AttachmentsByMessage,
  promptTexts: Readonly<Record<string, string>>,
): readonly ConversationMessage[] {
  return messages.map((message) => {
    const attached = message.role === "user" ? attachments.get(message.id) : undefined;
    if (!attached || attached.length === 0) {
      return message;
    }
    const original = promptTexts[message.id];
    if (original === undefined) {
      return { ...message, attachments: [...attached] };
    }
    return {
      ...message,
      attachments: [...attached],
      contentBlocks: [{ type: "text", text: original }],
      textSegments: [original],
    };
  });
}
