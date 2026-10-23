import { z } from "zod";
import { errorResponse, readJsonBody } from "../http/json";
import { audioExtension, type VoiceService } from "../voice/voice-service";
import type { Route } from "./route-table";

const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

const TranscribeBodySchema = z.object({ audioBase64: z.string().min(1), mimeType: z.string().min(1) });
const SynthesizeBodySchema = z.object({ text: z.string().trim().min(1) });

export function voiceRoutes(voice: VoiceService): readonly Route[] {
  return [
    {
      method: "POST",
      pattern: "stt/transcribe",
      handle: async ({ request }) => {
        const body = await readJsonBody(request, TranscribeBodySchema);
        if (!body) {
          return errorResponse(400, "invalid_request", "audioBase64 and mimeType are required");
        }
        const extension = audioExtension(body.mimeType);
        if (!extension) {
          return errorResponse(400, "unsupported_audio", `Unsupported audio type ${body.mimeType}`);
        }
        const audio = Buffer.from(body.audioBase64, "base64");
        if (audio.byteLength === 0 || audio.byteLength > MAX_AUDIO_BYTES) {
          return errorResponse(400, "invalid_audio", "Audio is empty or too large");
        }
        return Response.json(await voice.transcribe(audio, extension));
      },
    },
    {
      method: "POST",
      pattern: "tts/synthesize",
      handle: async ({ request }) => {
        const body = await readJsonBody(request, SynthesizeBodySchema);
        if (!body) {
          return errorResponse(400, "invalid_request", "text is required");
        }
        return new Response(await voice.speak(body.text), { headers: { "Content-Type": "audio/mpeg" } });
      },
    },
  ];
}
