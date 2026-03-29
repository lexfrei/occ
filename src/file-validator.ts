/**
 * File validation for send_file tool.
 * Extracted for testability.
 */

import { realpathSync } from "node:fs";
import path from "node:path";

const MAX_FILE_SIZE = 1_000_000;
const MAX_CONTENT_CHARS = 4000;

interface ValidFile {
  readonly content: string;
  readonly fileName: string;
  readonly truncated: boolean;
  readonly originalLength: number;
}

/** Validate and read a file for sending via OpenClaw. */
export async function validateAndReadFile(filePath: string, cwd: string): Promise<ValidFile> {
  const resolved = path.resolve(cwd, filePath);

  // Trailing slash prevents sibling directory prefix attacks (/app vs /app-evil)
  if (!resolved.startsWith(`${cwd}/`)) {
    throw new Error("filePath must be within the project directory");
  }

  const file = Bun.file(resolved);

  if (!(await file.exists())) {
    throw new Error(`File not found: ${filePath}`);
  }

  // Resolve symlinks to prevent escape via symlink pointing outside cwd
  // Both paths must be resolved to handle macOS /var → /private/var
  const realPath = realpathSync(resolved);
  const realCwd = realpathSync(cwd);

  if (!realPath.startsWith(`${realCwd}/`)) {
    throw new Error("filePath resolves outside the project directory (symlink)");
  }

  // Check size before reading to prevent OOM on very large files
  if (file.size > MAX_FILE_SIZE) {
    throw new Error(`File too large: ${String(file.size)} bytes (max ${String(MAX_FILE_SIZE)})`);
  }

  const bytes = new Uint8Array(await file.arrayBuffer());

  if (bytes.includes(0)) {
    throw new Error("Binary files are not supported");
  }

  const fullContent = new TextDecoder().decode(bytes);
  const truncated = fullContent.length > MAX_CONTENT_CHARS;
  const content = truncated ? fullContent.slice(0, MAX_CONTENT_CHARS) : fullContent;

  return {
    content,
    fileName: path.basename(resolved),
    truncated,
    originalLength: fullContent.length,
  };
}
