export function userMessageId(conversationId: string, turn: number): string {
  return `${conversationId}:u${turn}`;
}

export function assistantMessageId(conversationId: string, turn: number): string {
  return `${conversationId}:a${turn}`;
}

export function approvalRequestId(conversationId: string, turn: number, approval: number): string {
  return `${assistantMessageId(conversationId, turn)}:approval:${approval}`;
}
