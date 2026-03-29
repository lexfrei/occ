/**
 * OpenClaw Gateway REST API client for proactive message delivery.
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

  /** Send a message to a specific channel/user via /hooks/agent. */
  async sendMessage(channel: string, to: string, text: string): Promise<DeliveryResult> {
    const url = `${this.baseUrl}/hooks/agent`;

    const response = await fetch(url, {
      method: "POST",
      headers: new Headers({
        authorization: `Bearer ${this.token}`,
        "content-type": "application/json",
      }),
      body: JSON.stringify({
        message: text,
        deliver: true,
        channel,
        to,
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`OpenClaw POST failed: ${String(response.status)} ${body.slice(0, 200)}`);
    }

    try {
      const body = (await response.json()) as Record<string, unknown>;
      const messageId = typeof body["id"] === "string" ? body["id"] : undefined;
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
