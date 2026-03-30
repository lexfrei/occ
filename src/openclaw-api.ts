/**
 * OpenClaw Gateway REST API client for proactive message delivery.
 * Uses POST /tools/invoke with the "message" tool for direct delivery
 * without triggering an agent turn.
 */

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
  async sendMessage(channel: string, to: string, text: string): Promise<DeliveryResult> {
    const url = `${this.baseUrl}/tools/invoke`;

    const response = await fetch(url, {
      method: "POST",
      headers: new Headers({
        authorization: `Bearer ${this.token}`,
        "content-type": "application/json",
      }),
      body: JSON.stringify({
        tool: "message",
        action: "send",
        args: {
          channel,
          to,
          message: text,
        },
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`OpenClaw POST failed: ${String(response.status)} ${body.slice(0, 200)}`);
    }

    try {
      const body = (await response.json()) as {
        ok?: boolean;
        result?: { details?: { messageId?: string } };
      };
      const messageId =
        typeof body.result?.details?.messageId === "string"
          ? body.result.details.messageId
          : undefined;
      return { delivered: true, messageId };
    } catch {
      return { delivered: true, messageId: undefined };
    }
  }

  /** Send a file as an attachment via base64 buffer. */
  async sendFile(
    channel: string,
    to: string,
    file: { fileName: string; contentType: string; buffer: string },
  ): Promise<DeliveryResult> {
    const url = `${this.baseUrl}/tools/invoke`;

    const response = await fetch(url, {
      method: "POST",
      headers: new Headers({
        authorization: `Bearer ${this.token}`,
        "content-type": "application/json",
      }),
      body: JSON.stringify({
        tool: "message",
        action: "send",
        args: {
          channel,
          target: to,
          message: file.fileName,
          buffer: file.buffer,
          filename: file.fileName,
          contentType: file.contentType,
        },
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`OpenClaw POST failed: ${String(response.status)} ${body.slice(0, 200)}`);
    }

    try {
      const body = (await response.json()) as {
        ok?: boolean;
        result?: { details?: { messageId?: string } };
      };
      const messageId =
        typeof body.result?.details?.messageId === "string"
          ? body.result.details.messageId
          : undefined;
      return { delivered: true, messageId };
    } catch {
      return { delivered: true, messageId: undefined };
    }
  }

  /** Check if the API is configured and available. */
  static isConfigured(token: string | undefined): token is string {
    return typeof token === "string" && token.length > 0;
  }
}
