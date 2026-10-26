import type { AssistantEvent } from "@vellumai/assistant-api";
import type { HermesPrompt } from "../hermes/schemas";

type SurfaceShowEvent = Extract<AssistantEvent, { type: "ui_surface_show" }>;

export type PromptReply =
  | {
      readonly kind: "control";
      readonly method: "clarify.respond";
      readonly params: { readonly prompt_id: string; readonly execution_generation: number; readonly answer: string };
      readonly summary: string;
    }
  | { readonly kind: "response"; readonly requestId: string; readonly value: string; readonly summary: string };

const CANCEL_ACTIONS = new Set(["cancel", "dismiss"]);
const CANCELLED = "Cancelled";

export function promptSurfaceId(assistantMessageId: string, prompt: HermesPrompt): string {
  return `${assistantMessageId}:prompt:${prompt.requestId}`;
}

function choiceId(index: number): string {
  return `choice-${index}`;
}

function surfaceBody(prompt: HermesPrompt): Pick<SurfaceShowEvent, "surfaceType" | "title" | "data"> {
  switch (prompt.kind) {
    case "clarify":
      return prompt.choices.length > 0
        ? {
            surfaceType: "choice",
            title: "Hermes has a question",
            data: {
              description: prompt.question,
              selectionMode: "single",
              options: prompt.choices.map((title, index) => ({ id: choiceId(index), title })),
            },
          }
        : {
            surfaceType: "form",
            title: "Hermes has a question",
            data: { description: prompt.question, submitLabel: "Reply", fields: [{ id: "answer", type: "textarea", label: "Your answer", required: true }] },
          };
    case "secret":
      return {
        surfaceType: "form",
        title: "Hermes needs a secret",
        data: {
          description: `${prompt.prompt}\n\nHermes stores it as \`${prompt.envVar}\`.`,
          submitLabel: "Save",
          fields: [{ id: "value", type: "password", label: prompt.envVar, required: true }],
        },
      };
    case "sudo":
      return {
        surfaceType: "form",
        title: "Hermes needs your password",
        data: {
          description: "A command Hermes is running needs administrator access.",
          submitLabel: "Send",
          fields: [{ id: "password", type: "password", label: "Password", required: true }],
        },
      };
    default: {
      const exhaustive: never = prompt;
      return exhaustive;
    }
  }
}

export function promptSurface(conversationId: string, assistantMessageId: string, prompt: HermesPrompt): SurfaceShowEvent {
  return {
    type: "ui_surface_show",
    conversationId,
    messageId: assistantMessageId,
    surfaceId: promptSurfaceId(assistantMessageId, prompt),
    display: "inline",
    actions: [{ id: "cancel", label: "Skip", style: "secondary" }],
    ...surfaceBody(prompt),
  };
}

function stringField(data: Readonly<Record<string, unknown>>, key: string): string {
  const value = data[key];
  return typeof value === "string" ? value : "";
}

function clarifyAnswer(prompt: Extract<HermesPrompt, { kind: "clarify" }>, actionId: string, data: Readonly<Record<string, unknown>>): string {
  const chosen = prompt.choices.findIndex((_title, index) => choiceId(index) === actionId);
  if (chosen !== -1) {
    return prompt.choices[chosen] ?? "";
  }
  const selected = data.selectedTitles;
  if (Array.isArray(selected) && typeof selected[0] === "string") {
    return selected[0];
  }
  return stringField(data, "answer").trim();
}

export function promptReply(prompt: HermesPrompt, actionId: string, data: Readonly<Record<string, unknown>>): PromptReply {
  const cancelled = CANCEL_ACTIONS.has(actionId);
  switch (prompt.kind) {
    case "clarify": {
      const answer = cancelled ? "" : clarifyAnswer(prompt, actionId, data);
      return {
        kind: "control",
        method: "clarify.respond",
        params: { prompt_id: prompt.control.promptId, execution_generation: prompt.control.generation, answer },
        summary: answer || CANCELLED,
      };
    }
    case "secret": {
      const value = cancelled ? "" : stringField(data, "value");
      return { kind: "response", requestId: prompt.requestId, value, summary: value ? `Saved ${prompt.envVar}` : CANCELLED };
    }
    case "sudo": {
      const password = cancelled ? "" : stringField(data, "password");
      return { kind: "response", requestId: prompt.requestId, value: password, summary: password ? "Password sent" : CANCELLED };
    }
    default: {
      const exhaustive: never = prompt;
      return exhaustive;
    }
  }
}
