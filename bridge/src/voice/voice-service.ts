import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { runHermesHelper, type HelperCommand } from "../hermes/helper-process";

const VOICE_TIMEOUT_MS = 180_000;

const SpeakResultSchema = z.union([
  z.object({ success: z.literal(true), file_path: z.string(), provider: z.string() }),
  z.object({ success: z.literal(false), error: z.string() }),
]);
const TranscribeResultSchema = z.union([
  z.object({ success: z.literal(true), text: z.string(), provider: z.string() }),
  z.object({ success: z.literal(false), error: z.string() }),
]);

const AUDIO_EXTENSIONS: Readonly<Record<string, string>> = {
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/mp4": "m4a",
  "audio/m4a": "m4a",
  "audio/x-m4a": "m4a",
  "audio/aac": "aac",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
};

export class SpeechUnavailableError extends Error {
  constructor(reason: string) {
    super(`Hermes text-to-speech is unavailable: ${reason}`);
    this.name = "SpeechUnavailableError";
  }
}

export class TranscriptionFailedError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "TranscriptionFailedError";
  }
}

export function audioExtension(mimeType: string): string | null {
  return AUDIO_EXTENSIONS[mimeType.split(";")[0]?.trim().toLowerCase() ?? ""] ?? null;
}

export class VoiceService {
  constructor(
    private readonly helper: HelperCommand,
    private readonly scratchDir: string,
  ) {}

  async speak(text: string): Promise<Uint8Array> {
    const outputPath = await this.scratchPath("mp3");
    try {
      const result = await runHermesHelper(this.helper, "voice", { action: "speak", text, output_path: outputPath }, SpeakResultSchema, VOICE_TIMEOUT_MS);
      if (!result.success) {
        throw new SpeechUnavailableError(result.error);
      }
      const audio = await readFile(result.file_path);
      if (audio.byteLength === 0) {
        throw new SpeechUnavailableError("Hermes produced no audio");
      }
      return audio;
    } finally {
      await rm(outputPath, { force: true });
    }
  }

  async transcribe(audio: Uint8Array, extension: string): Promise<{ text: string; providerId: string }> {
    const inputPath = await this.scratchPath(extension);
    try {
      await writeFile(inputPath, audio, { mode: 0o600 });
      const result = await runHermesHelper(this.helper, "voice", { action: "transcribe", file_path: inputPath }, TranscribeResultSchema, VOICE_TIMEOUT_MS);
      if (!result.success) {
        throw new TranscriptionFailedError(result.error);
      }
      return { text: result.text.trim(), providerId: result.provider };
    } finally {
      await rm(inputPath, { force: true });
    }
  }

  private async scratchPath(extension: string): Promise<string> {
    await mkdir(this.scratchDir, { recursive: true, mode: 0o700 });
    return join(this.scratchDir, `${randomUUID()}.${extension}`);
  }
}
