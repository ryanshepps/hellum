import { readFileSync, writeFileSync } from "node:fs";

export type VoiceRequest = { action: string; text?: string; output_path?: string; file_path?: string };

export const FAKE_SPEECH = "ID3 fake speech";

export function handleVoice(request: VoiceRequest): object {
  switch (request.action) {
    case "speak":
      if (process.env.FAKE_HERMES_TTS_BROKEN) {
        return { success: false, error: "TTS generation failed (edge): 403" };
      }
      writeFileSync(request.output_path ?? "", `${FAKE_SPEECH}: ${request.text}`);
      return { success: true, file_path: request.output_path, provider: "edge" };
    case "transcribe": {
      const heard = readFileSync(request.file_path ?? "", "utf8");
      return heard.startsWith("noise") ? { success: false, error: "No speech detected" } : { success: true, text: ` ${heard} `, provider: "local" };
    }
    default:
      return { success: false, error: `unknown action ${request.action}` };
  }
}
