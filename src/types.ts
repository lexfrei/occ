/** OpenAI content block (multimodal format). */
export interface ContentBlock {
  readonly type: string;
  readonly text?: string;
  readonly image_url?: { readonly url: string };
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

/** A button in an interactive message block. */
export interface InteractiveButton {
  readonly label: string;
  readonly value: string;
}

/** A select option in an interactive message block. */
export interface InteractiveOption {
  readonly label: string;
  readonly value: string;
}

/** A single interactive block (buttons or select). */
export interface InteractiveBlock {
  readonly type: string;
  readonly text?: string | undefined;
  readonly buttons?: readonly InteractiveButton[] | undefined;
  readonly options?: readonly InteractiveOption[] | undefined;
}

/** Interactive payload for OpenClaw messages (buttons, selects). */
export interface InteractivePayload {
  readonly blocks: readonly InteractiveBlock[];
}

/** Options for sending a message with optional threading and interactive content. */
export interface SendMessageOptions {
  readonly replyTo?: string | undefined;
  readonly interactive?: InteractivePayload | undefined;
}

/** Options for adding/removing a reaction. */
export interface ReactOptions {
  readonly emoji: string;
  readonly remove?: boolean | undefined;
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
