/** OpenAI content block (multimodal format). */
interface ContentBlock {
  readonly type: string;
  readonly text?: string;
}

/** OpenAI chat completion message. Content can be string or array of blocks. */
export interface ChatMessage {
  readonly role: "system" | "user" | "assistant";
  readonly content: string | readonly ContentBlock[];
}

/** OpenAI chat completion request body. */
export interface ChatCompletionRequest {
  readonly model: string;
  readonly messages: readonly ChatMessage[];
  readonly stream?: boolean;
  readonly temperature?: number;
  readonly max_tokens?: number;
}

/** Application configuration. */
export interface OccConfig {
  /** Port for the OpenAI-compatible HTTP server. */
  readonly port: number;
  /** Bearer token clients must send (OpenClaw's apiKey for this provider). */
  readonly apiToken: string;
  /** OpenClaw Gateway URL for proactive messaging. */
  readonly openclawUrl: string;
  /** OpenClaw Gateway token for proactive messaging. Undefined = proactive disabled. */
  readonly openclawToken: string | undefined;
  /** Timeout for Claude Code to reply (ms). */
  readonly replyTimeoutMs: number;
}
