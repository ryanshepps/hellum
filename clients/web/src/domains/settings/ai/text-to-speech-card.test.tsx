/**
 * Tests that `TextToSpeechCard`'s Save provisions the *daemon* (not just
 * localStorage): it stores the API key in the credential store and PATCHes
 * `services.tts`, mapping the "Voice ID" input to `voiceId`. The bridge moves
 * both into Hermes, so this is what makes a UI save actually reach Hermes.
 *
 * The providers query is disabled (useIsOrgReady → false) so the card falls
 * back to the static TTS catalog and performs no network fetch.
 */
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

const ASSISTANT_ID = "asst-test";

mock.module("@/assistant/use-active-assistant-id", () => ({
  useActiveAssistantId: () => ASSISTANT_ID,
}));
mock.module("@vellumai/design-library/components/toast", () => ({
  toast: { success: () => {}, error: () => {} },
  Toaster: () => null,
  ToastContent: () => null,
}));
let orgReady = false;
mock.module("@/hooks/use-is-org-ready", () => ({
  useIsOrgReady: () => orgReady,
  useOrgHeaderReadiness: () => (orgReady ? "ready" : "resolving"),
}));
// Controllable daemon config the config-get query resolves to. `initialData`
// makes it available even though the query is `enabled: isOrgReady` (false),
// mirroring how the real query would already be cached. Default `{ services: {} }`
// leaves the daemon with no tts provider, so the happy-path tests still PATCH it.
let daemonConfigData: { services: Record<string, unknown> } = { services: {} };
// When set, the tts-providers query resolves to this catalog (as `initialData`,
// so no async settling) — lets tests exercise a daemon-fetched provider list.
let ttsCatalogData: { providers: unknown[] } | undefined;
let managedVoicesData:
  { voices: unknown[]; defaultModel: string | null } | undefined;
mock.module("@/generated/daemon/@tanstack/react-query.gen", () => ({
  ttsProvidersGetOptions: () => ({
    queryKey: ["tts-providers-test"],
    queryFn: () => Promise.resolve(ttsCatalogData ?? { providers: [] }),
    ...(ttsCatalogData ? { initialData: ttsCatalogData } : {}),
  }),
  configGetOptions: () => ({
    queryKey: ["config-get-test"],
    queryFn: () => Promise.resolve(daemonConfigData),
    initialData: daemonConfigData,
  }),
  configGetQueryKey: () => ["config-get-test"],
  // The card falls back to the static managed-voice catalog when this
  // query has no data, which is the state these tests exercise.
  ttsManagedvoicesGetOptions: () => ({
    queryKey: ["tts-managed-voices-test"],
    queryFn: () =>
      Promise.resolve(managedVoicesData ?? { voices: [], defaultModel: null }),
    ...(managedVoicesData ? { initialData: managedVoicesData } : {}),
  }),
}));

interface SdkCall {
  path?: unknown;
  body?: unknown;
}
const credentialsSetCalls: SdkCall[] = [];
const configPatchCalls: SdkCall[] = [];
mock.module("@/generated/daemon/sdk.gen", () => ({
  credentialsSetPost: (opts: SdkCall) => {
    credentialsSetCalls.push(opts);
    return Promise.resolve({ response: { ok: true, status: 200 } });
  },
  configPatch: (opts: SdkCall) => {
    configPatchCalls.push(opts);
    return Promise.resolve({ response: { ok: true, status: 200 } });
  },
  ttsSynthesizePost: () => Promise.resolve({ response: { ok: false } }),
}));

const { TextToSpeechCard } =
  await import("@/domains/settings/ai/text-to-speech-card");

function renderCard() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <TextToSpeechCard />
    </QueryClientProvider>,
  );
}

function selectProvider(label: string): void {
  const trigger = document.querySelector<HTMLButtonElement>(
    'button[role="combobox"][aria-label="TTS provider"]',
  );
  if (!trigger) {
    throw new Error("expected the TTS provider dropdown trigger");
  }
  fireEvent.click(trigger);
  const option = Array.from(
    document.querySelectorAll<HTMLElement>('[role="option"]'),
  ).find((o) => o.textContent?.trim() === label);
  if (!option) {
    throw new Error(`expected option "${label}"`);
  }
  fireEvent.click(option);
}

describe("TextToSpeechCard — daemon provisioning on Save", () => {
  beforeEach(() => {
    localStorage.clear();
    credentialsSetCalls.length = 0;
    configPatchCalls.length = 0;
    daemonConfigData = { services: {} };
    orgReady = false;
    ttsCatalogData = undefined;
    managedVoicesData = undefined;
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  test("ElevenLabs Save stores the key and maps Voice ID → services.tts.providers.elevenlabs.voiceId", async () => {
    renderCard();

    selectProvider("ElevenLabs");
    fireEvent.change(screen.getByPlaceholderText("sk_…"), {
      target: { value: "el-secret" },
    });
    fireEvent.change(screen.getByPlaceholderText("Enter a voice ID"), {
      target: { value: "voice-123" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(configPatchCalls.length).toBe(1));
    expect(credentialsSetCalls).toHaveLength(1);
    expect(credentialsSetCalls[0]!.path).toEqual({
      assistant_id: ASSISTANT_ID,
    });
    expect(credentialsSetCalls[0]!.body).toMatchObject({
      service: "elevenlabs",
      field: "api_key",
      value: "el-secret",
    });
    expect(configPatchCalls[0]!.body).toMatchObject({
      services: {
        tts: {
          provider: "elevenlabs",
          providers: { elevenlabs: { voiceId: "voice-123" } },
        },
      },
    });
  });

  test("does not clobber a daemon-set provider when only the key changes", async () => {
    // Daemon already has a provider configured elsewhere (CLI/other client).
    daemonConfigData = { services: { tts: { provider: "elevenlabs" } } };
    renderCard();

    // Enter ONLY an API key; leave the dropdown on the daemon's provider.
    fireEvent.change(screen.getByPlaceholderText("sk_…"), {
      target: { value: "el-secret" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(credentialsSetCalls.length).toBe(1));
    // The config PATCH (if any) must not carry a `provider` key — re-saving a
    // key must not switch the live provider.
    const ttsBody = configPatchCalls[0]?.body as
      { services?: { tts?: Record<string, unknown> } } | undefined;
    expect(ttsBody?.services?.tts ?? {}).not.toHaveProperty("provider");
  });

  test("a keyless provider shows no API key field", () => {
    daemonConfigData = { services: { tts: { provider: "edge" } } };
    renderCard();

    expect(screen.queryByText("API Key")).toBeNull();
    expect(screen.getByRole("button", { name: "Test" })).toBeTruthy();
  });

  test("Test waits until the provider is saved, since Hermes speaks it", () => {
    daemonConfigData = { services: { tts: { provider: "edge" } } };
    renderCard();

    selectProvider("ElevenLabs");

    const test = screen.getByRole("button", { name: "Test" }) as HTMLButtonElement;
    expect(test.disabled).toBe(true);
  });
});

describe("TextToSpeechCard — managed voices", () => {
  beforeEach(() => {
    localStorage.clear();
    credentialsSetCalls.length = 0;
    configPatchCalls.length = 0;
    daemonConfigData = { services: {} };
    orgReady = false;
    ttsCatalogData = undefined;
    managedVoicesData = undefined;
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  test("a fetched managed-voice catalog replaces the static list and default", () => {
    // Daemon advertises voice selection and the platform serves the catalog;
    // the dropdown must offer the fetched voices (not the static fallback)
    // and decorate the platform's default.
    orgReady = true;
    daemonConfigData = { services: { tts: { provider: "vellum" } } };
    ttsCatalogData = {
      providers: [
        {
          id: "vellum",
          displayName: "Vellum",
          subtitle: "Managed TTS.",
          supportsVoiceSelection: true,
          apiKeyPlaceholder: "",
          credentialsGuide: { description: "", url: "", linkLabel: "" },
        },
      ],
    };
    managedVoicesData = {
      voices: [
        {
          model: "EXAVITQu4vr4xnSDxMaL",
          label: "Sarah",
          description: "American · professional, reassuring, confident",
          sampleUrl:
            "https://storage.googleapis.com/eleven-public-prod/premade/voices/EXAVITQu4vr4xnSDxMaL/sample.mp3",
          source: "elevenlabs",
        },
        {
          model: "aura-2-zeus-en",
          label: "Zeus",
          description: "American · deep, trustworthy, smooth",
          sampleUrl: "https://static.deepgram.com/examples/Aura-2-zeus.wav",
          source: "deepgram",
        },
      ],
      defaultModel: "EXAVITQu4vr4xnSDxMaL",
    };
    renderCard();

    const voiceTrigger = document.querySelector<HTMLButtonElement>(
      'button[aria-label="Voice"]',
    );
    expect(voiceTrigger).not.toBeNull();
    fireEvent.click(voiceTrigger!);
    const options = Array.from(
      document.querySelectorAll<HTMLElement>(
        '[role="option"]:not([aria-label])',
      ),
    ).map((o) => o.textContent?.trim());
    // A voice reads as its character traits in sentence case, with its
    // upstream source as a suffix badge so users can tell providers apart
    // while browsing, not only after selecting. The proper name is dropped
    // (the assistant has its own) and the accent heads the group instead of
    // repeating on every row.
    expect(options).toContain(
      "Professional, reassuring, confident (default)ElevenLabs",
    );
    expect(options).toContain("Deep, trustworthy, smoothDeepgram");
    expect(options?.join(" ")).not.toContain("Sarah");
    expect(options?.join(" ")).not.toContain("Zeus");
    // Voices sort by traits within a group: "deep…" before "professional…".
    // The accent heads its group as a `role="group"` label, not an option row.
    expect(options).toEqual([
      "Deep, trustworthy, smoothDeepgram",
      "Professional, reassuring, confident (default)ElevenLabs",
    ]);
    expect(
      document.querySelector('[role="group"][aria-label="American"]'),
    ).not.toBeNull();
    // Static-catalog-only voices must not appear once the fetch supplies data.
    expect(options?.join(" ")).not.toContain("Thalia");
    // The selected voice has a hosted sample, so its per-row preview renders.
    expect(
      document.querySelector('button[aria-label^="Preview"]'),
    ).not.toBeNull();
  });

  test("the per-row preview is hidden for voices without a hosted sample", () => {
    orgReady = true;
    daemonConfigData = { services: { tts: { provider: "vellum" } } };
    ttsCatalogData = {
      providers: [
        {
          id: "vellum",
          displayName: "Vellum",
          subtitle: "Managed TTS.",
          supportsVoiceSelection: true,
          apiKeyPlaceholder: "",
          credentialsGuide: { description: "", url: "", linkLabel: "" },
        },
      ],
    };
    managedVoicesData = {
      voices: [
        {
          model: "voice-without-preview",
          label: "Nova",
          description: "A voice the platform serves without a hosted sample",
          sampleUrl: "",
          source: "elevenlabs",
        },
      ],
      defaultModel: "voice-without-preview",
    };
    renderCard();

    fireEvent.click(
      document.querySelector<HTMLButtonElement>('button[aria-label="Voice"]')!,
    );
    // The row renders, but with no sample there's no per-row preview button.
    expect(
      document.querySelector('[role="option"]:not([aria-label])'),
    ).not.toBeNull();
    expect(document.querySelector('button[aria-label^="Preview"]')).toBeNull();
  });

  test("a successful empty catalog hides the voice picker instead of falling back", () => {
    // An empty catalog is authoritative ("nothing offered right now") — the
    // static fallback must not resurface voices the platform would reject.
    orgReady = true;
    daemonConfigData = { services: { tts: { provider: "vellum" } } };
    ttsCatalogData = {
      providers: [
        {
          id: "vellum",
          displayName: "Vellum",
          subtitle: "Managed TTS.",
          supportsVoiceSelection: true,
          apiKeyPlaceholder: "",
          credentialsGuide: { description: "", url: "", linkLabel: "" },
        },
      ],
    };
    managedVoicesData = { voices: [], defaultModel: null };
    renderCard();

    expect(document.querySelector('button[aria-label="Voice"]')).toBeNull();
    expect(
      screen.getByText("No managed voices are currently available."),
    ).toBeTruthy();
  });
});
