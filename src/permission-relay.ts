/**
 * Permission relay: parse yes/no verdicts from user messages
 * and format approval prompts.
 *
 * ID alphabet is [a-km-z] — skips 'l' to avoid confusion with 1/I on phones.
 */

import { type PermissionBehavior } from "./types.js";

const PERMISSION_VERDICT_PATTERN = /^\s*(?<answer>y|yes|n|no)\s+(?<code>[a-km-z]{5})\s*$/iu;

export interface PermissionVerdict {
  readonly requestId: string;
  readonly behavior: PermissionBehavior;
}

export interface PermissionRequest {
  readonly requestId: string;
  readonly toolName: string;
  readonly description: string;
  readonly inputPreview: string;
}

export function parsePermissionVerdict(text: string): PermissionVerdict | undefined {
  const match = PERMISSION_VERDICT_PATTERN.exec(text);
  const answer = match?.groups?.["answer"];
  const code = match?.groups?.["code"];

  if (!answer || !code) {
    return undefined;
  }

  return {
    requestId: code.toLowerCase(),
    behavior: answer.toLowerCase().startsWith("y") ? "allow" : "deny",
  };
}

export function formatPermissionPrompt(request: PermissionRequest): string {
  return [
    `Claude wants to run \`${request.toolName}\`: ${request.description}`,
    "",
    "```",
    request.inputPreview,
    "```",
    "",
    `Reply "yes ${request.requestId}" or "no ${request.requestId}"`,
  ].join("\n");
}
