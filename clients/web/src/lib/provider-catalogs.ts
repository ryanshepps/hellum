/**
 * Static provider catalog data for TTS, STT, email, and image generation.
 *
 * Each catalog is a readonly array of provider descriptors used by the
 * corresponding settings card to populate dropdowns, display credential
 * guides, and gate feature availability.
 */
import type { ElectronHostOS } from "@vellumai/ipc-contract";

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

export interface ProviderCredentialsGuide {
  description: string;
  url: string;
  linkLabel: string;
}

// ---------------------------------------------------------------------------
// TTS
// ---------------------------------------------------------------------------

export interface TTSProvider {
  id: string;
  displayName: string;
  subtitle: string;
  supportsVoiceSelection: boolean;
  apiKeyPlaceholder: string;
  credentialsGuide: ProviderCredentialsGuide;
}

export const TTS_PROVIDERS: readonly TTSProvider[] = [
  {
    id: "edge",
    displayName: "Edge",
    subtitle: "Microsoft Edge's free neural voices. No API key needed.",
    supportsVoiceSelection: true,
    apiKeyPlaceholder: "",
    credentialsGuide: {
      description:
        "Edge voices need no key. Enter a voice name such as en-US-AriaNeural to change it.",
      url: "https://github.com/NousResearch/hermes-agent",
      linkLabel: "Read the docs",
    },
  },
  {
    id: "elevenlabs",
    displayName: "ElevenLabs",
    subtitle: "High-quality voice synthesis. Requires an ElevenLabs API key.",
    supportsVoiceSelection: true,
    apiKeyPlaceholder: "sk_…",
    credentialsGuide: {
      description:
        "Sign in to ElevenLabs, go to your Profile, and copy your API key.",
      url: "https://elevenlabs.io/app/settings/api-keys",
      linkLabel: "Open ElevenLabs API Keys",
    },
  },
];

// ---------------------------------------------------------------------------
// STT
// ---------------------------------------------------------------------------

export interface STTProvider {
  id: string;
  displayName: string;
  subtitle: string;
  /**
   * Only offered when the renderer can reach a desktop-native recognizer. See
   * `isNativeDictationSupported()` in `@/runtime/native-dictation-partials`.
   */
  requiresNativeDictation?: boolean;
  /**
   * Prerequisite the user must complete before the provider works. Shown
   * below the provider dropdown in place of a credentials guide.
   */
  setupWarning?: string;
  /** Absent for keyless providers (on-device recognition needs no API key). */
  apiKeyPlaceholder?: string;
  credentialsGuide?: ProviderCredentialsGuide;
}

interface NativeSttProviderCopy {
  displayName: string;
  subtitle: string;
  setupWarning: string;
}

/**
 * Stable id for native desktop recognition. The macOS-prefixed value is kept
 * for persisted settings compatibility. Native recognition never calls
 * `/v1/stt/transcribe`. Duplicated as a literal in
 * `@/domains/chat/voice/stt-api.ts` (`prefersMacosNativeStt`) — cross-domain
 * constants stay duplicated there, like the `LS_STT_*` keys.
 */
export const MACOS_NATIVE_STT_PROVIDER_ID = "macos-native";

export const STT_PROVIDERS: readonly STTProvider[] = [
  {
    id: "local",
    displayName: "Local Whisper",
    subtitle: "Whisper running on this Mac. Works offline and needs no API key.",
  },
  {
    id: "groq",
    displayName: "Groq",
    subtitle: "Fast hosted Whisper from Groq. Requires a Groq API key.",
    apiKeyPlaceholder: "gsk_…",
    credentialsGuide: {
      description:
        "Sign in to the Groq console and create an API key.",
      url: "https://console.groq.com/keys",
      linkLabel: "Open Groq Console",
    },
  },
  {
    id: "openai",
    displayName: "OpenAI",
    subtitle: "OpenAI's transcription models. Requires an OpenAI API key.",
    apiKeyPlaceholder: "sk-…",
    credentialsGuide: {
      description:
        "Sign in to the OpenAI platform, navigate to API Keys, and create a new secret key.",
      url: "https://platform.openai.com/api-keys",
      linkLabel: "Open OpenAI API Keys",
    },
  },
  {
    id: "elevenlabs",
    displayName: "ElevenLabs",
    subtitle: "ElevenLabs Scribe. Requires an ElevenLabs API key.",
    apiKeyPlaceholder: "sk_…",
    credentialsGuide: {
      description:
        "Sign in to ElevenLabs, go to your Profile, and copy your API key.",
      url: "https://elevenlabs.io/app/settings/api-keys",
      linkLabel: "Open ElevenLabs API Keys",
    },
  },
  {
    id: "mistral",
    displayName: "Mistral",
    subtitle: "Mistral's Voxtral transcription. Requires a Mistral API key.",
    apiKeyPlaceholder: "Enter your Mistral API key",
    credentialsGuide: {
      description:
        "Sign in to the Mistral console and create an API key.",
      url: "https://console.mistral.ai/api-keys",
      linkLabel: "Open Mistral Console",
    },
  },
  {
    id: "deepinfra",
    displayName: "DeepInfra",
    subtitle: "Open Whisper models hosted by DeepInfra. Requires a DeepInfra API key.",
    apiKeyPlaceholder: "Enter your DeepInfra API key",
    credentialsGuide: {
      description:
        "Sign in to DeepInfra and create an API key.",
      url: "https://deepinfra.com/dash/api_keys",
      linkLabel: "Open DeepInfra",
    },
  },
  {
    id: "xai",
    displayName: "xAI",
    subtitle: "Transcription from xAI. Requires an xAI API key.",
    apiKeyPlaceholder: "Enter your xAI API key",
    credentialsGuide: {
      description:
        "Sign in to the xAI console, navigate to API Keys, and create a new key.",
      url: "https://console.x.ai/",
      linkLabel: "Open xAI Console",
    },
  },
  {
    id: MACOS_NATIVE_STT_PROVIDER_ID,
    displayName: "macOS Native Dictation",
    subtitle:
      "Apple's on-device speech recognition, running locally through the macOS helper. Works offline and needs no API key.",
    requiresNativeDictation: true,
    setupWarning:
      "Requires macOS Dictation to be turned on: open System Settings → Keyboard, then enable Dictation. macOS downloads the on-device speech model the first time Dictation is enabled — without it, voice input produces no transcript.",
  },
];

export function sttProvidersForHostOS(
  hostOS: ElectronHostOS | null,
  windowsCopy: NativeSttProviderCopy,
): readonly STTProvider[] {
  if (hostOS !== "windows") {
    return STT_PROVIDERS;
  }
  return STT_PROVIDERS.map((provider) =>
    provider.id === MACOS_NATIVE_STT_PROVIDER_ID
      ? {
          id: MACOS_NATIVE_STT_PROVIDER_ID,
          requiresNativeDictation: true,
          ...windowsCopy,
        }
      : provider,
  );
}

// ---------------------------------------------------------------------------
// Email BYO
// ---------------------------------------------------------------------------

export interface EmailByoProvider {
  id: "mailgun" | "resend";
  displayName: string;
  setupSkill: string;
  docsUrl: string;
}

export const EMAIL_BYO_PROVIDERS: readonly EmailByoProvider[] = [
  {
    id: "mailgun",
    displayName: "Mailgun",
    setupSkill: "mailgun-setup",
    docsUrl: "https://www.mailgun.com/",
  },
  {
    id: "resend",
    displayName: "Resend",
    setupSkill: "resend-setup",
    docsUrl: "https://resend.com/",
  },
];

// ---------------------------------------------------------------------------
// Image generation
// ---------------------------------------------------------------------------

export const AVAILABLE_IMAGE_GEN_MODELS = [
  "gemini-3.1-flash-image-preview",
  "gemini-3-pro-image-preview",
  "gpt-image-2",
] as const;

export const IMAGE_GEN_MODEL_DISPLAY_NAMES: Record<string, string> = {
  "gemini-3.1-flash-image-preview": "Nano Banana 2",
  "gemini-3-pro-image-preview": "Nano Banana Pro",
  "gpt-image-2": "GPT Image 2",
};

/**
 * Image-generation providers offered by the settings card. `vellum` is the
 * managed option (no API key; billed to the Vellum account); `gemini`,
 * `openai`, and `openrouter` use the user's key. OpenRouter has no static
 * model list: its catalog is live.
 */
export const IMAGE_GEN_PROVIDERS = [
  "vellum",
  "gemini",
  "openai",
  "openrouter",
] as const;

export const IMAGE_GEN_PROVIDER_DISPLAY_NAMES: Record<string, string> = {
  vellum: "Vellum",
  gemini: "Gemini",
  openai: "OpenAI",
  openrouter: "OpenRouter",
};

export const DEFAULT_OPENROUTER_IMAGE_MODEL =
  "google/gemini-3.1-flash-image-preview";

/**
 * Models selectable under a provider. Vellum spans both backends (the daemon
 * derives the managed proxy from the model prefix); BYOK providers list only
 * the models their key can serve.
 */
export function imageGenModelsForProvider(provider: string): string[] {
  if (provider === "openrouter") {
    return [];
  }
  if (provider === "vellum") {
    return [...AVAILABLE_IMAGE_GEN_MODELS];
  }
  return AVAILABLE_IMAGE_GEN_MODELS.filter(
    (m) => providerForImageGenModel(m) === provider,
  );
}

/**
 * Image-generation provider for a model id, by prefix. Mirrors the daemon's
 * `providerForImageModelPrefix` / `providerForModel` (`assistant/src/media/`):
 * `gpt-*` / `dall-e-*` → openai, `gemini-*` → gemini, otherwise gemini.
 */
export function providerForImageGenModel(modelId: string): "openai" | "gemini" {
  if (modelId.startsWith("gpt-") || modelId.startsWith("dall-e-")) {
    return "openai";
  }
  if (modelId.startsWith("gemini-")) {
    return "gemini";
  }
  return "gemini";
}
