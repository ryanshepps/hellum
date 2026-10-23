import { z } from "zod";
import { AttachmentTooLargeError, type AttachmentStore } from "../attachments/attachment-store";
import { messageAttachmentView } from "../attachments/attachment-views";
import { errorResponse, readJsonBody } from "../http/json";
import type { Route } from "./route-table";

const DeleteBodySchema = z.object({ attachmentId: z.string().min(1) });

function summary(attachment: { id: string; filename: string; mimeType: string; sizeBytes: number; kind: string }) {
  const { id, filename, mimeType, sizeBytes, kind } = attachment;
  return { id, filename, mimeType, sizeBytes, kind };
}

export function attachmentRoutes(store: AttachmentStore): readonly Route[] {
  return [
    {
      method: "POST",
      pattern: "attachments",
      handle: async ({ request }) => {
        const form = await request.formData().catch(() => null);
        const file = form?.get("file");
        if (!form || !(file instanceof Blob)) {
          return errorResponse(400, "invalid_request", "Upload a file in the multipart field 'file'");
        }
        const filename = String(form.get("filename") ?? (file instanceof File ? file.name : "") ?? "attachment");
        const mimeType = String(form.get("mimeType") ?? file.type ?? "application/octet-stream") || "application/octet-stream";
        try {
          return Response.json(summary(await store.save(new Uint8Array(await file.arrayBuffer()), filename, mimeType)));
        } catch (error) {
          if (error instanceof AttachmentTooLargeError) {
            return errorResponse(413, "attachment_too_large", error.message);
          }
          throw error;
        }
      },
    },
    {
      method: "GET",
      pattern: "attachments",
      handle: ({ query }) => {
        const attachments = store.forConversation(query.get("conversationId")).filter((attachment) => attachment.messageId !== null);
        return Response.json({
          attachments: attachments.map((attachment) => ({
            ...summary(attachment),
            messageId: attachment.messageId ?? "",
            createdAt: attachment.createdAt,
            fileBacked: true,
            sightFrame: false,
            ambientKeep: false,
          })),
          total: attachments.length,
          hasMore: false,
        });
      },
    },
    {
      method: "GET",
      pattern: "attachments/:id",
      handle: async ({ params }) => {
        const attachment = store.get(params.id ?? "");
        if (!attachment) {
          return errorResponse(404, "not_found", "No such attachment");
        }
        const view = await messageAttachmentView(store, attachment);
        return Response.json({ ...summary(attachment), data: view.data ?? null, fileBacked: true });
      },
    },
    {
      method: "GET",
      pattern: "attachments/:id/content",
      handle: ({ params }) => {
        const attachment = store.get(params.id ?? "");
        if (!attachment) {
          return errorResponse(404, "not_found", "No such attachment");
        }
        return new Response(store.file(attachment.id), {
          headers: {
            "Content-Type": attachment.mimeType,
            "Content-Disposition": `inline; filename="${attachment.filename.replace(/"/g, "")}"`,
            "Cache-Control": "private, max-age=31536000, immutable",
          },
        });
      },
    },
    {
      method: "DELETE",
      pattern: "attachments",
      handle: async ({ request }) => {
        const body = await readJsonBody(request, DeleteBodySchema);
        if (!body) {
          return errorResponse(400, "invalid_request", "attachmentId is required");
        }
        return (await store.remove(body.attachmentId)) ? Response.json({ ok: true }) : errorResponse(404, "not_found", "No such attachment");
      },
    },
  ];
}
