/** OpenAI chat completion message. */
export interface ChatMessage {
  readonly role: "system" | "user" | "assistant";
  readonly content: string;
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
}
