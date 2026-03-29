/**
 * Extract and format context from OpenAI chat completion requests.
 */

import { type ChatCompletionRequest, type ChatMessage, type ContentBlock } from "./types.js";

/** Extracted context from an OpenClaw chat completion request. */
export interface RequestContext {
  /** The last user message text. */
  readonly userMessage: string;
  /** Conversation history (non-system messages before the current user message). */
  readonly history: readonly ChatMessage[];
  /** Image URLs from the last user message. */
  readonly mediaUrls: readonly string[];
  /** First 500 chars of system prompt (OpenClaw skills/memory/SOUL.md). */
  readonly systemSummary: string | undefined;
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
    return (content as readonly ContentBlock[])
      .filter((block) => block.type === "text" && block.text)
      .map((block) => block.text ?? "")
      .join("\n");
  }

  return "";
}

/** Extract image URLs from multimodal content blocks. */
export function extractMediaUrls(content: ChatMessage["content"] | undefined): readonly string[] {
  if (!Array.isArray(content)) {
    return [];
  }

  return (content as readonly ContentBlock[])
    .filter((block) => block.type === "image_url" && block.image_url?.url)
    .map((block) => block.image_url?.url ?? "");
}

const SYSTEM_SUMMARY_MAX_CHARS = 500;

function buildSystemSummary(text: string | undefined): string | undefined {
  const trimmed = text?.trim();

  if (!trimmed || trimmed.length === 0) {
    return undefined;
  }

  const truncated = trimmed.length > SYSTEM_SUMMARY_MAX_CHARS;
  return trimmed.slice(0, SYSTEM_SUMMARY_MAX_CHARS) + (truncated ? "..." : "");
}

/** Extract full context from a chat completion request and headers. */
export function extractContext(body: ChatCompletionRequest, headers: Headers): RequestContext {
  const systemMessage = body.messages.find((message) => message.role === "system");
  const systemText = systemMessage ? extractText(systemMessage.content) : undefined;
  const systemSummary = buildSystemSummary(systemText);

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
  const mediaUrls = extractMediaUrls(lastUserContent);

  return {
    userMessage,
    history,
    mediaUrls,
    systemSummary,
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

  if (context.systemSummary) {
    parts.push(`[Agent context: ${context.systemSummary}]`);
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

  for (const url of context.mediaUrls) {
    parts.push(`[Image: ${url}]`);
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
