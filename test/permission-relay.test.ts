import { describe, expect, it } from "bun:test";

import { formatPermissionPrompt, parsePermissionVerdict } from "../src/permission-relay.js";

describe("parsePermissionVerdict", () => {
  it("parses 'yes' verdict", () => {
    const verdict = parsePermissionVerdict("yes abcde");

    expect(verdict).toEqual({ requestId: "abcde", behavior: "allow" });
  });

  it("parses 'no' verdict", () => {
    const verdict = parsePermissionVerdict("no abcde");

    expect(verdict).toEqual({ requestId: "abcde", behavior: "deny" });
  });

  it("parses short 'y' form", () => {
    const verdict = parsePermissionVerdict("y abcde");

    expect(verdict).toEqual({ requestId: "abcde", behavior: "allow" });
  });

  it("parses short 'n' form", () => {
    const verdict = parsePermissionVerdict("n abcde");

    expect(verdict).toEqual({ requestId: "abcde", behavior: "deny" });
  });

  it("is case-insensitive", () => {
    const verdict = parsePermissionVerdict("YES ABCDE");

    expect(verdict).toEqual({ requestId: "abcde", behavior: "allow" });
  });

  it("tolerates leading and trailing whitespace", () => {
    const verdict = parsePermissionVerdict("  yes abcde  ");

    expect(verdict).toEqual({ requestId: "abcde", behavior: "allow" });
  });

  it("rejects IDs containing 'l' (excluded from alphabet)", () => {
    const verdict = parsePermissionVerdict("yes abcle");

    expect(verdict).toBeUndefined();
  });

  it("rejects IDs with wrong length", () => {
    expect(parsePermissionVerdict("yes abcd")).toBeUndefined();
    expect(parsePermissionVerdict("yes abcdef")).toBeUndefined();
  });

  it("returns undefined for regular messages", () => {
    expect(parsePermissionVerdict("hello world")).toBeUndefined();
    expect(parsePermissionVerdict("yes please")).toBeUndefined();
    expect(parsePermissionVerdict("no thanks")).toBeUndefined();
  });

  it("returns undefined for empty strings", () => {
    expect(parsePermissionVerdict("")).toBeUndefined();
    expect(parsePermissionVerdict("   ")).toBeUndefined();
  });
});

describe("formatPermissionPrompt", () => {
  it("formats a readable permission prompt", () => {
    const prompt = formatPermissionPrompt({
      requestId: "abcde",
      toolName: "Bash",
      description: "List files in current directory",
      inputPreview: '{"command":"ls -la"}',
    });

    expect(prompt).toContain("Claude wants to run `Bash`");
    expect(prompt).toContain("List files in current directory");
    expect(prompt).toContain('{"command":"ls -la"}');
    expect(prompt).toContain('Reply "yes abcde" or "no abcde"');
  });
});
