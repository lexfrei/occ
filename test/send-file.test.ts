import { mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "bun:test";

import { validateAndReadFile } from "../src/file-validator.js";

describe("validateAndReadFile", () => {
  const testDirectory = mkdtempSync(path.join(tmpdir(), "occ-test-"));

  it("reads a text file within the project directory", async () => {
    const filePath = path.join(testDirectory, "hello.txt");
    writeFileSync(filePath, "hello world");

    const result = await validateAndReadFile("hello.txt", testDirectory);

    expect(result.content).toBe("hello world");
    expect(result.fileName).toBe("hello.txt");
    expect(result.truncated).toBe(false);
    expect(result.originalLength).toBe(11);
  });

  it("rejects path traversal with ../", () => {
    const promise = validateAndReadFile("../../etc/passwd", testDirectory);
    expect(promise).rejects.toThrow("within the project directory");
  });

  it("rejects absolute path outside project", () => {
    const promise = validateAndReadFile("/etc/passwd", testDirectory);
    expect(promise).rejects.toThrow("within the project directory");
  });

  it("rejects sibling directory prefix attack", () => {
    const sibling = `../${path.basename(testDirectory)}-evil/secret`;
    const promise = validateAndReadFile(sibling, testDirectory);
    expect(promise).rejects.toThrow("within the project directory");
  });

  it("rejects cwd itself (directory, not file)", () => {
    const promise = validateAndReadFile(".", testDirectory);
    expect(promise).rejects.toThrow("within the project directory");
  });

  it("rejects nonexistent file", () => {
    const promise = validateAndReadFile("nonexistent.txt", testDirectory);
    expect(promise).rejects.toThrow("File not found");
  });

  it("rejects binary files with null bytes", () => {
    const filePath = path.join(testDirectory, "binary.bin");
    writeFileSync(filePath, Buffer.from([0x48, 0x45, 0x00, 0x4c, 0x4f]));

    const promise = validateAndReadFile("binary.bin", testDirectory);
    expect(promise).rejects.toThrow("Binary files");
  });

  it("rejects symlinks pointing outside project directory", () => {
    const linkPath = path.join(testDirectory, "escape-link.txt");
    symlinkSync("/etc/hosts", linkPath);

    const promise = validateAndReadFile("escape-link.txt", testDirectory);
    expect(promise).rejects.toThrow("outside the project directory");
  });

  it("rejects files over 1MB", () => {
    const filePath = path.join(testDirectory, "large.txt");
    writeFileSync(filePath, "x".repeat(1_100_000));

    const promise = validateAndReadFile("large.txt", testDirectory);
    expect(promise).rejects.toThrow("too large");
  });

  it("truncates content over 4000 chars and reports truncation", async () => {
    const filePath = path.join(testDirectory, "long.txt");
    writeFileSync(filePath, "y".repeat(10_000));

    const result = await validateAndReadFile("long.txt", testDirectory);

    expect(result.truncated).toBe(true);
    expect(result.content).toHaveLength(4000);
    expect(result.originalLength).toBe(10_000);
  });
});
