const MAX_TITLE_LENGTH = 40;
const MAX_TITLE_WORDS = 7;

const TRIMMED_TITLE_WORDS = 5;

const META_FAILURE_TITLES = new Set([
  "missing context",
  "no context",
  "insufficient context",
  "unclear context",
  "empty context",
  "no topic",
  "unclear topic",
  "unclear request",
  "unclear message",
  "empty conversation",
  "empty message",
  "no content",
]);

const LEAKED_PROSE_PREFIXES = [
  "i need to",
  "i needed to",
  "i should",
  "i will",
  "i'll",
  "i can ",
  "i can't",
  "i cannot",
  "i'm ",
  "i am ",
  "i've ",
  "i have ",
  "i'd ",
  "i would",
  "let me",
  "looking at",
  "based on",
  "given the",
  "to generate",
  "to summarize",
  "to title",
  "the user wants",
  "the user asked",
  "the user is",
  "the user wanted",
  "the user needs",
  "the user said",
  "the user has",
  "the user would",
  "the user's request",
  "the conversation is",
  "this conversation is",
  "the conversation appears",
  "the conversation seems",
  "the conversation covers",
  "the conversation discusses",
  "the assistant should",
  "the assistant is",
  "the assistant wants",
  "the assistant needs",
  "the title should",
  "the title is",
  "the title would",
  "the title for",
  "here's ",
  "here is ",
  "here are ",
  "sure,",
  "okay,",
  "ok,",
];

export function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, "$1")    .replace(/__(.+?)__/g, "$1")    .replace(/\*(.+?)\*/g, "$1")    .replace(/(?<!\w)_(.+?)_(?!\w)/g, "$1")    .replace(/~~(.+?)~~/g, "$1")    .replace(/`(.+?)`/g, "$1")    .replace(/\[(.+?)\]\(.+?\)/g, "$1")    .replace(/^#{1,6}\s+/gm, "");}

export function stripThinkingTags(text: string): string {
  return text
    .replace(/<thinking>[\s\S]*?<\/thinking>/gi, "")
    .replace(/<thought>[\s\S]*?<\/thought>/gi, "")
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<thought>/gi, "")
    .replace(/<\/thought>/gi, "")
    .replace(/<thinking>/gi, "")
    .replace(/<\/thinking>/gi, "")
    .replace(/<think>/gi, "")
    .replace(/<\/think>/gi, "")
    .replace(/<:[^>]*>/gi, "");
}

export function truncateTitle(title: string): string {
  if (title.length <= MAX_TITLE_LENGTH) {
    return title;
  }
  const words = title.split(/\s+/);
  const kept =
    words.length > MAX_TITLE_WORDS
      ? words.slice(0, TRIMMED_TITLE_WORDS)
      : words;
  let result = "";
  for (const word of kept) {
    const candidate = result ? result + " " + word : word;
    if (candidate.length > MAX_TITLE_LENGTH) {
      break;
    }
    result = candidate;
  }
  return result || title.slice(0, MAX_TITLE_LENGTH);
}

function looksLikeLeakedProse(title: string): boolean {
  if (/\n/.test(title)) {
    return true;
  }
  if (/\b(?:user|assistant)\s*:/i.test(title)) {
    return true;
  }
  const lower = title.toLowerCase();
  if (LEAKED_PROSE_PREFIXES.some((prefix) => lower.startsWith(prefix))) {
    return true;
  }
  if (/[.?!]$/.test(title) && title.split(/\s+/).length > 5) {
    return true;
  }
  return false;
}

export function normalizeTitle(raw: string): string {
  let title = raw.trim().replace(/^["']|["']$/g, "");
  title = stripMarkdown(title);
  title = stripThinkingTags(title).trim();
  if (!title) {
    return "";
  }
  if (looksLikeLeakedProse(title)) {
    return "";
  }
  if (META_FAILURE_TITLES.has(title.toLowerCase())) {
    return "";
  }
  return truncateTitle(title);
}
