import type { ConversationMessage, ConversationMessageAttachment } from "@vellumai/assistant-api";
import type { AttachmentsByMessage } from "../translate/message-attachments";
import type { Attachment, AttachmentStore } from "./attachment-store";

export const INLINE_IMAGE_LIMIT_BYTES = 1_500_000;

export function toMessageAttachment(attachment: Attachment, inlineData: string | null): ConversationMessageAttachment {
  return {
    id: attachment.id,
    filename: attachment.filename,
    mimeType: attachment.mimeType,
    sizeBytes: attachment.sizeBytes,
    kind: attachment.kind,
    fileBacked: true,
    ...(inlineData ? { data: inlineData } : {}),
  };
}

export async function messageAttachmentView(store: AttachmentStore, attachment: Attachment): Promise<ConversationMessageAttachment> {
  const inline = attachment.kind === "image" && attachment.sizeBytes <= INLINE_IMAGE_LIMIT_BYTES;
  return toMessageAttachment(attachment, inline ? Buffer.from(await store.bytes(attachment.id)).toString("base64") : null);
}

export async function attachmentsByMessage(
  store: AttachmentStore,
  messages: readonly ConversationMessage[],
): Promise<AttachmentsByMessage> {
  const entries = await Promise.all(
    messages
      .filter((message) => message.role === "user")
      .map(async (message) => [message.id, await Promise.all(store.forMessage(message.id).map((attachment) => messageAttachmentView(store, attachment)))] as const),
  );
  return new Map(entries.filter(([, attachments]) => attachments.length > 0));
}
