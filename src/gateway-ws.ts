/**
 * OpenClaw Gateway WebSocket client.
 *
 * Connects to the Gateway, performs device auth handshake,
 * listens for chat events, and sends replies via chat.send.
 */

import { getDeviceIdentity, signChallenge } from "./device-identity.js";
import { type InboundMessage, type OccConfig } from "./types.js";

/** WebSocket frame types from Gateway protocol. */
interface WsRequest {
  readonly type: "req";
  readonly id: string;
  readonly method: string;
  readonly params: Record<string, unknown>;
}

interface WsResponse {
  readonly type: "res";
  readonly id: string;
  readonly ok: boolean;
  readonly payload?: Record<string, unknown>;
  readonly error?: { readonly code: string; readonly message: string };
}

interface WsEvent {
  readonly type: "event";
  readonly event: string;
  readonly payload?: Record<string, unknown>;
}

type WsFrame = WsRequest | WsResponse | WsEvent;

interface ChatEventMessage {
  readonly role: string;
  readonly content: readonly { readonly type: string; readonly text?: string }[];
  readonly timestamp?: number;
}

interface ChatEventPayload {
  readonly sessionKey: string;
  readonly state: string;
  readonly message: ChatEventMessage;
}

type MessageCallback = (message: InboundMessage) => void;

const MAX_RECONNECT_DELAY_MS = 30_000;
const INITIAL_RECONNECT_DELAY_MS = 1000;

export class GatewayWebSocket {
  private readonly wsUrl: string;
  private readonly token: string;
  private readonly sessionKeys: ReadonlySet<string>;

  private websocket: WebSocket | undefined;
  private onMessage: MessageCallback | undefined;
  private reconnectDelayMs = INITIAL_RECONNECT_DELAY_MS;
  private messageIdCounter = 0;
  private requestIdCounter = 0;
  private pendingResponses = new Map<string, (response: WsResponse) => void>();
  private stopped = false;
  private tickTimer: ReturnType<typeof setInterval> | undefined;

  constructor(config: OccConfig) {
    const baseUrl = config.openclawUrl.replace(/^http/u, "ws");
    this.wsUrl = `${baseUrl}/gateway`;
    this.token = config.openclawToken;
    this.sessionKeys = new Set(config.sessionKey.split(",").map((key) => key.trim()));
  }

  /** Register callback for inbound user messages. */
  onInboundMessage(callback: MessageCallback): void {
    this.onMessage = callback;
  }

  /** Connect to Gateway and start listening. */
  async start(): Promise<void> {
    this.stopped = false;
    await this.connect();
  }

  /** Disconnect and stop reconnecting. */
  stop(): void {
    this.stopped = true;
    this.clearTickTimer();

    if (this.websocket) {
      this.websocket.close();
      this.websocket = undefined;
    }
  }

  /** Send a reply into an OpenClaw session via chat.send. */
  async sendReply(sessionKey: string, text: string): Promise<void> {
    const requestId = this.nextRequestId();

    const request: WsRequest = {
      type: "req",
      id: requestId,
      method: "chat.send",
      params: {
        sessionKey,
        message: text,
        idempotencyKey: crypto.randomUUID(),
      },
    };

    await this.sendRequest(request);
    console.error(`[occ] WS reply sent to session ${sessionKey}`);
  }

  private async connect(): Promise<void> {
    const identity = await getDeviceIdentity();

    console.error(
      `[occ] connecting to ${this.wsUrl} (device: ${identity.deviceId.slice(0, 12)}...)`,
    );

    return new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(this.wsUrl);

      ws.addEventListener("message", (event) => {
        const data = typeof event.data === "string" ? event.data : "";
        this.handleFrame(data, identity).catch((error: unknown) => {
          const errorMessage = error instanceof Error ? error.message : String(error);
          console.error(`[occ] WS frame error: ${errorMessage}`);
        });
      });

      ws.addEventListener("open", () => {
        this.websocket = ws;
        this.reconnectDelayMs = INITIAL_RECONNECT_DELAY_MS;
        console.error("[occ] WS connected, waiting for challenge...");
        resolve();
      });

      ws.addEventListener("close", () => {
        this.handleDisconnect();
      });

      ws.addEventListener("error", () => {
        console.error("[occ] WS connection error");
        reject(new Error("WebSocket connection failed"));
      });
    });
  }

  private handleDisconnect(): void {
    this.clearTickTimer();
    this.websocket = undefined;

    if (!this.stopped) {
      console.error(`[occ] WS disconnected, reconnecting in ${String(this.reconnectDelayMs)}ms...`);
      setTimeout(() => {
        this.connect().catch((error: unknown) => {
          const errorMessage = error instanceof Error ? error.message : String(error);
          console.error(`[occ] WS reconnect error: ${errorMessage}`);
        });
      }, this.reconnectDelayMs);
      this.reconnectDelayMs = Math.min(this.reconnectDelayMs * 2, MAX_RECONNECT_DELAY_MS);
    }
  }

  private async handleFrame(
    raw: string,
    identity: Awaited<ReturnType<typeof getDeviceIdentity>>,
  ): Promise<void> {
    const frame = JSON.parse(raw) as WsFrame;

    if (frame.type === "event") {
      if (frame.event === "connect.challenge") {
        await this.handleChallenge(frame, identity);
      } else if (frame.event === "chat") {
        this.handleChatEvent(frame);
      }
    } else if (frame.type === "res") {
      const resolver = this.pendingResponses.get(frame.id);

      if (resolver) {
        this.pendingResponses.delete(frame.id);
        resolver(frame);
      }
    }
  }

  private async handleChallenge(
    frame: WsEvent,
    identity: Awaited<ReturnType<typeof getDeviceIdentity>>,
  ): Promise<void> {
    const payloadRecord = frame.payload;
    const nonceValue = payloadRecord?.["nonce"];
    const nonce = typeof nonceValue === "string" ? nonceValue : "";

    if (!nonce) {
      console.error("[occ] challenge missing nonce");
      return;
    }

    const { signature, signedAt } = await signChallenge(identity, nonce, this.token);

    const connectRequest: WsRequest = {
      type: "req",
      id: this.nextRequestId(),
      method: "connect",
      params: {
        minProtocol: 3,
        maxProtocol: 3,
        client: {
          id: "occ",
          version: "0.0.1",
          platform: process.platform === "darwin" ? "macos" : process.platform,
          mode: "backend",
        },
        role: "operator",
        scopes: ["operator.read", "operator.write"],
        auth: { token: this.token },
        device: {
          id: identity.deviceId,
          publicKey: identity.publicKeyBase64Url,
          signature,
          signedAt,
          nonce,
        },
        locale: "en-US",
      },
    };

    const response = await this.sendRequest(connectRequest);

    if (response.ok) {
      console.error("[occ] WS authenticated successfully");
      const policy = response.payload?.["policy"] as Record<string, unknown> | undefined;
      const tickIntervalMs = Number(policy?.["tickIntervalMs"]) || 15_000;
      this.startTickTimer(tickIntervalMs);
    } else {
      const errorMessage = response.error?.message ?? "unknown error";
      console.error(`[occ] WS auth failed: ${errorMessage}`);
    }
  }

  private handleChatEvent(frame: WsEvent): void {
    if (!this.onMessage) {
      return;
    }

    const payload = frame.payload as unknown as ChatEventPayload | undefined;

    if (!payload?.message || !payload.sessionKey) {
      return;
    }

    if (!this.sessionKeys.has(payload.sessionKey)) {
      return;
    }

    if (payload.message.role !== "user") {
      return;
    }

    if (payload.state !== "final") {
      return;
    }

    const textContent = payload.message.content
      .filter((block) => block.type === "text" && block.text)
      .map((block) => block.text ?? "")
      .join("\n");

    if (textContent.length === 0) {
      return;
    }

    this.messageIdCounter += 1;

    const message: InboundMessage = {
      id: `ws-${String(this.messageIdCounter)}`,
      platform: "unknown",
      senderName: "User",
      senderId: "unknown",
      chatId: payload.sessionKey,
      content: textContent,
      timestamp: payload.message.timestamp
        ? new Date(payload.message.timestamp).toISOString()
        : new Date().toISOString(),
      sessionKey: payload.sessionKey,
    };

    this.onMessage(message);
  }

  private async sendRequest(request: WsRequest): Promise<WsResponse> {
    return new Promise<WsResponse>((resolve, reject) => {
      if (this.websocket?.readyState !== WebSocket.OPEN) {
        reject(new Error("WebSocket not connected"));
        return;
      }

      const timeoutMs = 10_000;
      const timer = setTimeout(() => {
        this.pendingResponses.delete(request.id);
        reject(new Error(`Request ${request.method} timed out`));
      }, timeoutMs);

      this.pendingResponses.set(request.id, (response) => {
        clearTimeout(timer);
        resolve(response);
      });

      this.websocket.send(JSON.stringify(request));
    });
  }

  private nextRequestId(): string {
    this.requestIdCounter += 1;
    return `occ-${String(this.requestIdCounter)}`;
  }

  private startTickTimer(intervalMs: number): void {
    this.clearTickTimer();
    this.tickTimer = setInterval(() => {
      if (this.websocket?.readyState === WebSocket.OPEN) {
        const pingFrame = { type: "req", id: this.nextRequestId(), method: "ping", params: {} };
        this.websocket.send(JSON.stringify(pingFrame));
      }
    }, intervalMs);
  }

  private clearTickTimer(): void {
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = undefined;
    }
  }
}
