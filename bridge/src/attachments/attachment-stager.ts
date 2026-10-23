import { z } from "zod";
import type { HermesGateway } from "../hermes/hermes-gateway";
import type { Attachment, AttachmentStore } from "./attachment-store";

const ImageAttachResultSchema = z.object({ attached: z.boolean() }).passthrough();
const FileAttachResultSchema = z.object({ ref_text: z.string() }).passthrough();

export class UnknownAttachmentError extends Error {
  constructor(id: string) {
    super(`No uploaded attachment ${id}`);
    this.name = "UnknownAttachmentError";
  }
}

export type StagedAttachments = {
  readonly attachments: readonly Attachment[];
  readonly fileRefs: readonly string[];
};

export function resolveAttachments(store: AttachmentStore, ids: readonly string[]): readonly Attachment[] {
  return ids.map((id) => {
    const attachment = store.get(id);
    if (!attachment) {
      throw new UnknownAttachmentError(id);
    }
    return attachment;
  });
}

export async function stageAttachments(
  gateway: HermesGateway,
  store: AttachmentStore,
  sid: string,
  attachments: readonly Attachment[],
): Promise<StagedAttachments> {
  const fileRefs: string[] = [];
  for (const attachment of attachments) {
    const base64 = Buffer.from(await store.bytes(attachment.id)).toString("base64");
    if (attachment.kind === "image") {
      await gateway.request(
        "image.attach_bytes",
        { session_id: sid, content_base64: base64, filename: attachment.filename },
        ImageAttachResultSchema,
      );
    } else {
      const staged = await gateway.request(
        "file.attach",
        { session_id: sid, data_url: `data:${attachment.mimeType};base64,${base64}`, name: attachment.filename },
        FileAttachResultSchema,
      );
      fileRefs.push(staged.ref_text);
    }
  }
  return { attachments, fileRefs };
}
