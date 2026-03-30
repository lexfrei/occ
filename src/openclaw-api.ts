/**
 * OpenClaw Gateway REST API client for proactive message delivery.
 * Uses POST /tools/invoke with the "message" tool for direct delivery
 * without triggering an agent turn.
 */

import { type ReactOptions, type SendMessageOptions } from "./types.js";

/** Result of sending a message through OpenClaw. */
export interface DeliveryResult {
  readonly delivered: boolean;
  readonly messageId: string | undefined;
}

export class OpenClawApi {
  private readonly baseUrl: string;
  private readonly token: string;

  constructor(baseUrl: string, token: string) {
    let url = baseUrl;
    while (url.endsWith("/")) {
      url = url.slice(0, -1);
    }
    this.baseUrl = url;
    this.token = token;
  }

  /** Send a message directly to a channel/user via /tools/invoke (no agent turn). */
  async sendMessage(
    channel: string,
    to: string,
    text: string,
    options?: SendMessageOptions,
  ): Promise<DeliveryResult> {
    const args: Record<string, unknown> = { channel, to, message: text };
    if (options?.replyTo) {
      args["replyTo"] = options.replyTo;
    }
    if (options?.interactive) {
      args["interactive"] = options.interactive;
    }
    return this.invokeAction("send", args);
  }

  /** Add or remove an emoji reaction on a message. */
  async reactToMessage(
    channel: string,
    to: string,
    messageId: string,
    options: ReactOptions,
  ): Promise<DeliveryResult> {
    const args: Record<string, unknown> = {
      channel,
      to,
      messageId,
      emoji: options.emoji,
    };
    if (options.remove) {
      args["remove"] = true;
    }
    return this.invokeAction("react", args);
  }

  /** Edit a previously sent message. */
  async editMessage(
    channel: string,
    to: string,
    messageId: string,
    text: string,
  ): Promise<DeliveryResult> {
    return this.invokeAction("edit", { channel, to, messageId, message: text });
  }

  /** Check if the API is configured and available. */
  static isConfigured(token: string | undefined): token is string {
    return typeof token === "string" && token.length > 0;
  }

  /** POST /tools/invoke with the given action and args, parse delivery result. */
  private async invokeAction(
    action: string,
    args: Record<string, unknown>,
  ): Promise<DeliveryResult> {
    const url = `${this.baseUrl}/tools/invoke`;

    const response = await fetch(url, {
      method: "POST",
      headers: new Headers({
        authorization: `Bearer ${this.token}`,
        "content-type": "application/json",
      }),
      body: JSON.stringify({ tool: "message", action, args }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`OpenClaw POST failed: ${String(response.status)} ${body.slice(0, 200)}`);
    }

    try {
      const body = (await response.json()) as {
        ok?: boolean;
        result?: {
          details?: {
            ok?: boolean;
            messageId?: string;
            hint?: string;
            reason?: string;
          };
        };
      };
      const details = body.result?.details;
      if (details?.ok === false) {
        const hint = details.hint ?? details.reason ?? "action failed";
        throw new Error(`OpenClaw action failed: ${hint}`);
      }
      const messageId = typeof details?.messageId === "string" ? details.messageId : undefined;
      return { delivered: true, messageId };
    } catch (error: unknown) {
      if (error instanceof Error && error.message.startsWith("OpenClaw")) {
        throw error;
      }
      return { delivered: true, messageId: undefined };
    }
  }
}
