export interface InboundMessage {
  readonly id: string;
  readonly platform: string;
  readonly senderName: string;
  readonly senderId: string;
  readonly chatId: string;
  readonly content: string;
  /** ISO 8601 timestamp. */
  readonly timestamp: string;
  readonly sessionKey: string;
}

export interface OutboundReply {
  readonly chatId: string;
  readonly text: string;
}

export interface SessionContext {
  readonly platform: string;
  readonly senderId: string;
  readonly senderName: string;
  readonly sessionKey: string;
  lastActivityMs: number;
  messageCount: number;
}

export type PermissionBehavior = "allow" | "deny";

export type TransportMode = "auto" | "ws" | "rest";

export interface OccConfig {
  readonly openclawUrl: string;
  readonly openclawToken: string;
  /** Comma-separated session keys to monitor. */
  readonly sessionKey: string;
  /** Empty set = allow all. */
  readonly allowedSenders: ReadonlySet<string>;
  /** REST transport only. */
  readonly pollIntervalMs: number;
  readonly sessionTtlMs: number;
  readonly transport: TransportMode;
}
