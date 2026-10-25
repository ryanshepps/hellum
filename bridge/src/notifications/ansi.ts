const ANSI_SEQUENCE_RE = /\u001b\[[0-?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)?/g;

const CONTROL_CHAR_RUN_RE = /[\u0000-\u001f\u007f-\u009f]+/g;

export function stripAnsiSequences(value: string): string {
  return value.replace(ANSI_SEQUENCE_RE, "");
}

export function stripAnsiAndControlChars(value: string, replacement = ""): string {
  return stripAnsiSequences(value).replace(CONTROL_CHAR_RUN_RE, replacement);
}
