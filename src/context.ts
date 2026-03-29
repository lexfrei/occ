/**
 * Extract and format context from OpenAI chat completion requests.
 */

import { type ChatCompletionRequest, type ChatMessage } from "./types.js";

/** Extracted context from an OpenClaw chat completion request. */
export interface RequestContext {
  /** The last user message text. */
  readonly userMessage: string;
  /** Conversation history (last N messages before the current one). */
  readonly history: readonly ChatMessage[];
  /** Channel metadata from HTTP headers. */
  readonly channel: string | undefined;
  /** Account/sender metadata from HTTP headers. */
  readonly accountId: string | undefined;
}

/** Extract text from OpenAI content (string or array of blocks). */
export function extractText(content: ChatMessage["content"] | undefined): string {
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return (content as readonly { type: string; text?: string }[])
      .filter((block) => block.type === "text" && block.text)
      .map((block) => block.text ?? "")
      .join("\n");
  }

  return "";
}

/** Extract full context from a chat completion request and headers. */
export function extractContext(body: ChatCompletionRequest, headers: Headers): RequestContext {
  const lastUserIndex = body.messages.findLastIndex((message) => message.role === "user");
  const foundUser = lastUserIndex !== -1;
  const lastUserContent = foundUser ? body.messages[lastUserIndex]?.content : undefined;
  const history = foundUser
    ? body.messages.filter(
        (message, index) =>
          index !== lastUserIndex && message.role !== "system" && index < lastUserIndex,
      )
    : [];
  const userMessage = extractText(lastUserContent);

  return {
    userMessage,
    history,
    channel: headers.get("x-openclaw-message-channel") ?? undefined,
    accountId: headers.get("x-openclaw-account-id") ?? undefined,
  };
}

/** Format context into a channel notification content string. */
export function formatNotificationContent(context: RequestContext): string {
  const parts: string[] = [];

  if (context.channel || context.accountId) {
    const prefix = [context.channel, context.accountId].filter(Boolean).join("/");
    parts.push(`[${prefix}]`);
  }

  if (context.history.length > 0) {
    const maxHistory = 3;
    const omitted = context.history.length - maxHistory;
    const recent = context.history.slice(-maxHistory);

    if (omitted > 0) {
      parts.push(`[${String(omitted)} earlier message${omitted > 1 ? "s" : ""} omitted]`);
    }

    const historyLines = recent.map((message) => {
      const text = extractText(message.content);
      return `${message.role}: ${text.slice(0, 200)}`;
    });
    parts.push(`Conversation context:\n${historyLines.join("\n")}\n---`);
  }

  parts.push(context.userMessage);

  return parts.join("\n");
}

/** Build meta object for channel notification. */
export function buildNotificationMeta(context: RequestContext): Record<string, string> {
  const meta: Record<string, string> = {};

  if (context.channel) {
    meta["channel"] = context.channel;
  }

  if (context.accountId) {
    meta["accountId"] = context.accountId;
  }

  return meta;
}
