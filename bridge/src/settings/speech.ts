import { z } from "zod";
import { SettingRejectedError, type HermesSettingsChange } from "./hermes-settings";
import { combineChanges, type SettingsSection } from "./settings-service";

type Guide = { readonly description: string; readonly url: string; readonly linkLabel: string };

type TtsProvider = {
  readonly id: string;
  readonly displayName: string;
  readonly subtitle: string;
  readonly voiceKey: string | null;
  readonly keyEnv: string | null;
  readonly guide: Guide;
};

type SttProvider = {
  readonly id: string;
  readonly displayName: string;
  readonly subtitle: string;
  readonly keyEnv: string | null;
};

const DEFAULT_TTS = "edge";
const DEFAULT_STT = "local";

function keyGuide(service: string, url: string): Guide {
  return { description: `Create an API key in your ${service} account and paste it here. Hermes keeps it in ~/.hermes/.env.`, url, linkLabel: `Open ${service}` };
}

function localGuide(description: string, url: string): Guide {
  return { description, url, linkLabel: "Read the docs" };
}

const HERMES_TTS_DOCS = "https://github.com/NousResearch/hermes-agent";

export const TTS_PROVIDERS: readonly TtsProvider[] = [
  {
    id: "edge",
    displayName: "Edge",
    subtitle: "Microsoft Edge's free neural voices. No API key needed.",
    voiceKey: "voice",
    keyEnv: null,
    guide: localGuide("Edge voices need no key. Enter a voice name such as en-US-AriaNeural to change it.", HERMES_TTS_DOCS),
  },
  {
    id: "elevenlabs",
    displayName: "ElevenLabs",
    subtitle: "High-quality voice synthesis. Requires an ElevenLabs API key.",
    voiceKey: "voice_id",
    keyEnv: "ELEVENLABS_API_KEY",
    guide: keyGuide("ElevenLabs", "https://elevenlabs.io/app/settings/api-keys"),
  },
  {
    id: "openai",
    displayName: "OpenAI",
    subtitle: "OpenAI's speech models, such as gpt-4o-mini-tts. Requires an OpenAI API key.",
    voiceKey: "voice",
    keyEnv: "VOICE_TOOLS_OPENAI_KEY",
    guide: keyGuide("OpenAI", "https://platform.openai.com/api-keys"),
  },
  {
    id: "gemini",
    displayName: "Gemini",
    subtitle: "Google's Gemini speech models. Requires a Gemini API key.",
    voiceKey: "voice",
    keyEnv: "GEMINI_API_KEY",
    guide: keyGuide("Google AI Studio", "https://aistudio.google.com/apikey"),
  },
  {
    id: "xai",
    displayName: "xAI",
    subtitle: "Expressive voices from xAI. Requires an xAI API key.",
    voiceKey: "voice_id",
    keyEnv: "XAI_API_KEY",
    guide: keyGuide("xAI", "https://console.x.ai/"),
  },
  {
    id: "mistral",
    displayName: "Mistral",
    subtitle: "Mistral's Voxtral speech. Requires a Mistral API key.",
    voiceKey: "voice_id",
    keyEnv: "MISTRAL_API_KEY",
    guide: keyGuide("Mistral", "https://console.mistral.ai/api-keys"),
  },
  {
    id: "minimax",
    displayName: "MiniMax",
    subtitle: "MiniMax speech models. Requires a MiniMax API key.",
    voiceKey: "voice_id",
    keyEnv: "MINIMAX_API_KEY",
    guide: keyGuide("MiniMax", "https://www.minimax.io/platform"),
  },
  {
    id: "deepinfra",
    displayName: "DeepInfra",
    subtitle: "Open speech models hosted by DeepInfra. Requires a DeepInfra API key.",
    voiceKey: "voice",
    keyEnv: "DEEPINFRA_API_KEY",
    guide: keyGuide("DeepInfra", "https://deepinfra.com/dash/api_keys"),
  },
  {
    id: "piper",
    displayName: "Piper",
    subtitle: "Fast local speech that runs on this Mac. No API key needed.",
    voiceKey: "voice",
    keyEnv: null,
    guide: localGuide("Piper runs on this Mac. Enter a voice name such as en_US-lessac-medium to change it.", "https://github.com/OHF-Voice/piper1-gpl/blob/main/docs/VOICES.md"),
  },
  {
    id: "kittentts",
    displayName: "KittenTTS",
    subtitle: "A tiny local speech model that runs on this Mac. No API key needed.",
    voiceKey: "voice",
    keyEnv: null,
    guide: localGuide("KittenTTS runs on this Mac and downloads its model on first use.", "https://github.com/KittenML/KittenTTS"),
  },
];

export const STT_PROVIDERS: readonly SttProvider[] = [
  { id: "local", displayName: "Local Whisper", subtitle: "Whisper running on this Mac. Works offline and needs no API key.", keyEnv: null },
  { id: "groq", displayName: "Groq", subtitle: "Fast hosted Whisper from Groq. Requires a Groq API key.", keyEnv: "GROQ_API_KEY" },
  { id: "openai", displayName: "OpenAI", subtitle: "OpenAI's transcription models. Requires an OpenAI API key.", keyEnv: "VOICE_TOOLS_OPENAI_KEY" },
  { id: "elevenlabs", displayName: "ElevenLabs", subtitle: "ElevenLabs Scribe. Requires an ElevenLabs API key.", keyEnv: "ELEVENLABS_API_KEY" },
  { id: "mistral", displayName: "Mistral", subtitle: "Mistral's Voxtral transcription. Requires a Mistral API key.", keyEnv: "MISTRAL_API_KEY" },
  { id: "deepinfra", displayName: "DeepInfra", subtitle: "Open Whisper models hosted by DeepInfra. Requires a DeepInfra API key.", keyEnv: "DEEPINFRA_API_KEY" },
  { id: "xai", displayName: "xAI", subtitle: "Transcription from xAI. Requires an xAI API key.", keyEnv: "XAI_API_KEY" },
];

export const SPEECH_KEY_ENV: Readonly<Record<string, string>> = Object.fromEntries(
  [...TTS_PROVIDERS, ...STT_PROVIDERS].flatMap((provider) => (provider.keyEnv ? [[provider.id, provider.keyEnv]] : [])),
);

export function ttsCatalog() {
  return TTS_PROVIDERS.map((provider) => ({
    id: provider.id,
    displayName: provider.displayName,
    subtitle: provider.subtitle,
    supportsVoiceSelection: provider.voiceKey !== null,
    apiKeyPlaceholder: provider.keyEnv ? `${provider.displayName} API key` : "",
    credentialsGuide: provider.guide,
  }));
}

export function sttCatalog() {
  return STT_PROVIDERS.map((provider) => ({
    id: provider.id,
    displayName: provider.displayName,
    subtitle: provider.subtitle,
    setupMode: provider.keyEnv ? "api-key" : "none",
    ...(provider.keyEnv ? { apiKeyProviderName: provider.id } : {}),
  }));
}

const VoicesSchema = z.record(z.string(), z.object({ voiceId: z.string().optional() }).passthrough());
const SpeechPatchSchema = z.object({
  services: z
    .object({
      tts: z.object({ provider: z.string().optional(), providers: VoicesSchema.optional() }).passthrough().optional(),
      stt: z.object({ provider: z.string().optional() }).passthrough().optional(),
    })
    .passthrough(),
});

function voiceKey(id: string): string {
  return `tts.${id}.${TTS_PROVIDERS.find((provider) => provider.id === id)?.voiceKey}`;
}

function ttsProviderChange(id: string): HermesSettingsChange {
  if (!TTS_PROVIDERS.some((provider) => provider.id === id)) {
    throw new SettingRejectedError(`Hermes has no ${id} text-to-speech provider`);
  }
  return { set: { "tts.provider": id } };
}

function voiceChanges(voices: z.infer<typeof VoicesSchema>): HermesSettingsChange[] {
  return Object.entries(voices).flatMap(([id, voice]) => {
    const provider = TTS_PROVIDERS.find((candidate) => candidate.id === id);
    if (!provider?.voiceKey || voice.voiceId === undefined) {
      return [];
    }
    const trimmed = voice.voiceId.trim();
    return [trimmed ? { set: { [voiceKey(id)]: trimmed } } : { unset: [voiceKey(id)] }];
  });
}

function sttProviderChange(id: string): HermesSettingsChange {
  if (!STT_PROVIDERS.some((provider) => provider.id === id)) {
    throw new SettingRejectedError(`Hermes has no ${id} speech-to-text provider`);
  }
  return { set: { "stt.provider": id } };
}

export const speechSection: SettingsSection = {
  keys: ["tts.provider", "stt.provider", ...TTS_PROVIDERS.flatMap((provider) => (provider.voiceKey ? [voiceKey(provider.id)] : []))],
  view: ({ values }) => {
    const voices = Object.fromEntries(
      TTS_PROVIDERS.flatMap((provider) => {
        const voice = provider.voiceKey ? values[voiceKey(provider.id)] : null;
        return typeof voice === "string" && voice ? [[provider.id, { voiceId: voice }]] : [];
      }),
    );
    return {
      services: {
        tts: { provider: typeof values["tts.provider"] === "string" && values["tts.provider"] ? values["tts.provider"] : DEFAULT_TTS, mode: "your-own", providers: voices },
        stt: { provider: typeof values["stt.provider"] === "string" && values["stt.provider"] ? values["stt.provider"] : DEFAULT_STT, mode: "your-own" },
      },
    };
  },
  change: (patch) => {
    const parsed = SpeechPatchSchema.safeParse(patch);
    if (!parsed.success) {
      return null;
    }
    const { tts, stt } = parsed.data.services;
    const changes = [
      ...(tts?.provider ? [ttsProviderChange(tts.provider)] : []),
      ...voiceChanges(tts?.providers ?? {}),
      ...(stt?.provider ? [sttProviderChange(stt.provider)] : []),
    ];
    return changes.length > 0 ? combineChanges(changes) : null;
  },
};
