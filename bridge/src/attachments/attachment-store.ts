import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { privateJsonFile, type JsonFile } from "../storage/json-file";

export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

const AttachmentSchema = z.object({
  id: z.uuid(),
  filename: z.string().min(1),
  mimeType: z.string().min(1),
  sizeBytes: z.number().int().nonnegative(),
  kind: z.enum(["image", "video", "document"]),
  createdAt: z.number(),
  conversationId: z.string().nullable(),
  messageId: z.string().nullable(),
});

const IndexSchema = z.object({ attachments: z.array(AttachmentSchema) });

export type Attachment = z.infer<typeof AttachmentSchema>;

export class AttachmentTooLargeError extends Error {
  constructor(sizeBytes: number) {
    super(`Attachment is ${sizeBytes} bytes; the limit is ${MAX_ATTACHMENT_BYTES}`);
    this.name = "AttachmentTooLargeError";
  }
}

export function attachmentKind(mimeType: string): Attachment["kind"] {
  if (mimeType.startsWith("image/")) {
    return "image";
  }
  return mimeType.startsWith("video/") ? "video" : "document";
}

function safeFilename(filename: string): string {
  const base = filename.split(/[\\/]/).at(-1)?.replace(/[^\w.\- ]+/g, "_").trim() ?? "";
  return base.length > 0 ? base.slice(0, 200) : "attachment";
}

export class AttachmentStore {
  private constructor(
    private readonly directory: string,
    private readonly index: JsonFile<z.infer<typeof IndexSchema>>,
    private attachments: readonly Attachment[],
  ) {}

  static async open(stateDir: string): Promise<AttachmentStore> {
    const directory = join(stateDir, "attachments");
    const index = privateJsonFile(join(directory, "index.json"), IndexSchema, { attachments: [] });
    return new AttachmentStore(directory, index, (await index.read()).attachments);
  }

  async save(bytes: Uint8Array, filename: string, mimeType: string): Promise<Attachment> {
    if (bytes.byteLength > MAX_ATTACHMENT_BYTES) {
      throw new AttachmentTooLargeError(bytes.byteLength);
    }
    const attachment: Attachment = {
      id: randomUUID(),
      filename: safeFilename(filename),
      mimeType,
      sizeBytes: bytes.byteLength,
      kind: attachmentKind(mimeType),
      createdAt: Date.now(),
      conversationId: null,
      messageId: null,
    };
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    await writeFile(this.pathFor(attachment.id), bytes, { mode: 0o600 });
    await this.persist([...this.attachments, attachment]);
    return attachment;
  }

  get(id: string): Attachment | null {
    return this.attachments.find((attachment) => attachment.id === id) ?? null;
  }

  bytes(id: string): Promise<Uint8Array> {
    return Bun.file(this.pathFor(id)).bytes();
  }

  file(id: string): Bun.BunFile {
    return Bun.file(this.pathFor(id));
  }

  forMessage(messageId: string): readonly Attachment[] {
    return this.attachments.filter((attachment) => attachment.messageId === messageId);
  }

  forConversation(conversationId: string | null): readonly Attachment[] {
    return this.attachments.filter((attachment) => conversationId === null || attachment.conversationId === conversationId);
  }

  link(ids: readonly string[], conversationId: string, messageId: string): Promise<void> {
    const linked = new Set(ids);
    return this.persist(
      this.attachments.map((attachment) => (linked.has(attachment.id) ? { ...attachment, conversationId, messageId } : attachment)),
    );
  }

  async remove(id: string): Promise<boolean> {
    if (!this.get(id)) {
      return false;
    }
    await this.persist(this.attachments.filter((attachment) => attachment.id !== id));
    await rm(this.pathFor(id), { force: true });
    return true;
  }

  async removeConversation(conversationId: string): Promise<void> {
    const doomed = this.attachments.filter((attachment) => attachment.conversationId === conversationId);
    await this.persist(this.attachments.filter((attachment) => attachment.conversationId !== conversationId));
    await Promise.all(doomed.map((attachment) => rm(this.pathFor(attachment.id), { force: true })));
  }

  private pathFor(id: string): string {
    return join(this.directory, AttachmentSchema.shape.id.parse(id));
  }

  private persist(attachments: readonly Attachment[]): Promise<void> {
    this.attachments = attachments;
    return this.index.write({ attachments: [...attachments] });
  }
}
