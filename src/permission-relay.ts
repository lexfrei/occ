/**
 * Permission relay: forward tool-use approval prompts to the user
 * through OpenClaw, parse yes/no verdicts from their responses.
 *
 * Protocol: Claude Code sends `notifications/claude/channel/permission_request`
 * with a 5-letter request_id. The user replies "yes <id>" or "no <id>".
 * We send back `notifications/claude/channel/permission` with the verdict.
 */

/**
 * Regex matching permission verdicts from user messages.
 * Matches: "y abcde", "yes abcde", "n abcde", "no abcde"
 * The ID alphabet is [a-km-z] (skips 'l' to avoid confusion with 1/I).
 * Case-insensitive to tolerate phone autocorrect.
 */
const PERMISSION_VERDICT_PATTERN = /^\s*(?<answer>y|yes|n|no)\s+(?<code>[a-km-z]{5})\s*$/iu;

/** Parsed permission verdict from a user message. */
export interface PermissionVerdict {
  readonly requestId: string;
  readonly behavior: "allow" | "deny";
}

/** Parameters from a permission request notification. */
export interface PermissionRequest {
  readonly requestId: string;
  readonly toolName: string;
  readonly description: string;
  readonly inputPreview: string;
}

/**
 * Try to parse a user message as a permission verdict.
 * Returns the verdict if matched, or undefined if the message is not a verdict.
 */
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

/** Format a permission request into a human-readable prompt. */
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
