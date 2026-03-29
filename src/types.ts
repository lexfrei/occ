/**
 * Shared types for OCC bridge.
 */

/** Metadata extracted from an OpenClaw inbound message. */
export interface InboundMessage {
  /** Unique identifier for this message. */
  readonly id: string;
  /** Platform the message originated from (telegram, whatsapp, discord, etc.). */
  readonly platform: string;
  /** Sender's display name. */
  readonly senderName: string;
  /** Sender's platform-specific identifier. */
  readonly senderId: string;
  /** Chat/conversation identifier for routing replies. */
  readonly chatId: string;
  /** The message text content. */
  readonly content: string;
  /** ISO 8601 timestamp. */
  readonly timestamp: string;
  /** OpenClaw session key this message belongs to. */
  readonly sessionKey: string;
}

/** Parameters for sending a reply back through OpenClaw. */
export interface OutboundReply {
  /** Chat/conversation identifier (maps back to OpenClaw session + channel). */
  readonly chatId: string;
  /** The response text. */
  readonly text: string;
}

/** Session context tracked per conversation. */
export interface SessionContext {
  /** Platform (telegram, whatsapp, etc.). */
  readonly platform: string;
  /** Sender's platform-specific identifier. */
  readonly senderId: string;
  /** Sender's display name. */
  readonly senderName: string;
  /** OpenClaw session key. */
  readonly sessionKey: string;
  /** Last activity timestamp (epoch ms). */
  lastActivityMs: number;
  /** Total messages seen in this session. */
  messageCount: number;
}

/** Transport mode for connecting to OpenClaw Gateway. */
export type TransportMode = "auto" | "ws" | "rest";

/** Application configuration. */
export interface OccConfig {
  /** OpenClaw Gateway base URL. */
  readonly openclawUrl: string;
  /** Bearer token for OpenClaw API auth. */
  readonly openclawToken: string;
  /** OpenClaw session keys to monitor (comma-separated). */
  readonly sessionKey: string;
  /** Allowed sender IDs (empty set = allow all). */
  readonly allowedSenders: ReadonlySet<string>;
  /** Polling interval in milliseconds (REST transport only). */
  readonly pollIntervalMs: number;
  /** Session TTL in milliseconds. */
  readonly sessionTtlMs: number;
  /** Transport mode: "ws" for WebSocket, "rest" for polling, "auto" tries WS first. */
  readonly transport: TransportMode;
}
