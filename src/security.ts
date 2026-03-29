/**
 * Sender gating: allowlist-based access control.
 *
 * Gates on sender ID (not room/channel ID) to prevent
 * unauthorized users in shared chats from injecting messages.
 */

import { type InboundMessage } from "./types.js";

export class SenderGate {
  private readonly allowedSenders: ReadonlySet<string>;

  /** @param allowedSenders Empty set = allow all. */
  constructor(allowedSenders: ReadonlySet<string>) {
    this.allowedSenders = allowedSenders;
  }

  isAllowed(message: InboundMessage): boolean {
    if (this.allowedSenders.size === 0) {
      return true;
    }

    return this.allowedSenders.has(message.senderId);
  }

  get isOpen(): boolean {
    return this.allowedSenders.size === 0;
  }

  get allowlistSize(): number {
    return this.allowedSenders.size;
  }
}
