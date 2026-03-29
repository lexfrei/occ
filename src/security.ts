/**
 * Sender gating: allowlist-based access control.
 *
 * Gates on sender ID (not room/channel ID) to prevent
 * unauthorized users in shared chats from injecting messages.
 */

import { type InboundMessage } from "./types.js";

export class SenderGate {
  private readonly allowedSenders: ReadonlySet<string>;

  /**
   * @param allowedSenders Set of allowed sender IDs. Empty set = allow all.
   */
  constructor(allowedSenders: ReadonlySet<string>) {
    this.allowedSenders = allowedSenders;
  }

  /** Check if a message's sender is allowed. */
  isAllowed(message: InboundMessage): boolean {
    if (this.allowedSenders.size === 0) {
      return true;
    }

    return this.allowedSenders.has(message.senderId);
  }

  /** Check if the gate is in open mode (allow all). */
  get isOpen(): boolean {
    return this.allowedSenders.size === 0;
  }

  /** Number of explicitly allowed senders. */
  get allowlistSize(): number {
    return this.allowedSenders.size;
  }
}
