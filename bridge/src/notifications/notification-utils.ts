import type { Root, RootContent } from "mdast";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { stripAnsiAndControlChars, stripAnsiSequences } from "./ansi";

const processor = unified().use(remarkParse).use(remarkGfm);

function parseMarkdown(text: string): Root {
  return processor.parse(text);
}

export function nonEmpty(value: string | null | undefined): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  return text.slice(0, maxLength - 1) + "…";
}

const BLOCK_CONTAINER_TYPES = new Set(["blockquote", "listItem", "footnoteDefinition"]);

function nodeText(node: RootContent): string {
  switch (node.type) {
    case "text":
    case "inlineCode":
    case "code":
      return node.value;
    case "html":
      return "";
    case "image":
    case "imageReference":
      return " ";
    case "break":
      return "\n";
    case "thematicBreak":
      return "";
    case "table":
    case "list":
      return node.children.map(nodeText).join("\n");
    case "tableRow":
      return node.children.map(nodeText).join(" ");
    default:
      return "children" in node ? node.children.map(nodeText).join(BLOCK_CONTAINER_TYPES.has(node.type) ? "\n\n" : "") : "";
  }
}

export function stripMarkdownForPreview(value: string): string {
  return parseMarkdown(value).children.map(nodeText).join("\n\n");
}

export type MediaEmbed = {
  readonly alt: string;
};

function collectMediaEmbeds(node: Root | RootContent, into: MediaEmbed[]): void {
  if (node.type === "image" || node.type === "imageReference") {
    into.push({ alt: node.alt ?? "" });
    return;
  }
  if ("children" in node) {
    for (const child of node.children) {
      collectMediaEmbeds(child, into);
    }
  }
}

export function mediaEmbeds(value: string): MediaEmbed[] {
  const embeds: MediaEmbed[] = [];
  collectMediaEmbeds(parseMarkdown(value), embeds);
  return embeds;
}

export function describeMedia(labels: readonly string[]): string {
  const [only] = labels;
  if (only === undefined) {
    return "";
  }
  if (labels.length > 1) {
    return `Sent ${labels.length} attachments`;
  }
  const label = sanitizeMessagePreview(only.replace(/\s+/g, " ").trim());
  return label ? `Sent ${label}` : "Sent an attachment";
}

function sanitize(value: string, maxLength: number): string {
  return truncate(stripAnsiAndControlChars(value, " ").trim(), maxLength);
}

export function collapseHorizontalWhitespace(value: string): string {
  return value
    .replace(/[^\S\n]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export const MESSAGE_PREVIEW_MAX_LENGTH = 200;

export function sanitizeMultilineMessagePreview(value: string): string {
  const normalized = stripAnsiSequences(value)
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]+/g, " ");
  return truncate(collapseHorizontalWhitespace(normalized), MESSAGE_PREVIEW_MAX_LENGTH);
}

export function sanitizeMessagePreview(value: string): string {
  return sanitize(value, MESSAGE_PREVIEW_MAX_LENGTH);
}

export const NOTIFICATION_TITLE_MAX_LENGTH = 60;

export function sanitizeNotificationTitle(value: string): string {
  return sanitize(value, NOTIFICATION_TITLE_MAX_LENGTH);
}
