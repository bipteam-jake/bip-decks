// Placeholder. Real implementation lands in the next session and will wrap
// @anthropic-ai/sdk per docs/bip-deck-platform-architecture.md.

export type MessageRole = 'system' | 'user' | 'assistant';

export interface ClaudeMessage {
  role: MessageRole;
  content: string;
}

export interface ClaudeResponse {
  content: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
}

export async function callClaude(_messages: ClaudeMessage[]): Promise<ClaudeResponse> {
  throw new Error('not implemented');
}
