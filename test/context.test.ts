import { describe, expect, it } from "bun:test";

import {
  type RequestContext,
  buildNotificationMeta,
  extractContext,
  extractMediaUrls,
  extractText,
  formatNotificationContent,
} from "../src/context.js";

describe("extractText", () => {
  it("extracts from string content", () => {
    expect(extractText("hello")).toBe("hello");
  });

  it("extracts from array content blocks", () => {
    const content = [
      { type: "text", text: "first" },
      { type: "text", text: "second" },
    ];

    expect(extractText(content)).toBe("first\nsecond");
  });

  it("filters non-text blocks", () => {
    const content = [{ type: "image_url" }, { type: "text", text: "visible" }];

    expect(extractText(content)).toBe("visible");
  });

  it("returns empty string for missing content", () => {
    // eslint-disable-next-line unicorn/no-useless-undefined -- testing undefined input path
    expect(extractText(undefined)).toBe("");
  });
});

describe("extractMediaUrls", () => {
  it("extracts image URLs from content blocks", () => {
    const urls = extractMediaUrls([
      { type: "image_url", image_url: { url: "https://example.com/photo.jpg" } },
      { type: "text", text: "caption" },
    ]);

    expect(urls).toEqual(["https://example.com/photo.jpg"]);
  });

  it("returns empty array for string content", () => {
    expect(extractMediaUrls("hello")).toEqual([]);
  });

  it("returns empty array when no images", () => {
    expect(extractMediaUrls([{ type: "text", text: "hello" }])).toEqual([]);
  });

  it("extracts multiple image URLs", () => {
    const urls = extractMediaUrls([
      { type: "image_url", image_url: { url: "https://a.com/1.jpg" } },
      { type: "image_url", image_url: { url: "https://b.com/2.jpg" } },
    ]);

    expect(urls).toHaveLength(2);
  });
});

describe("extractContext", () => {
  it("extracts user message from simple request", () => {
    const context = extractContext(
      { model: "test", messages: [{ role: "user", content: "hello" }] },
      new Headers(),
    );

    expect(context.userMessage).toBe("hello");
    expect(context.history).toHaveLength(0);
    expect(context.channel).toBeUndefined();
  });

  it("extracts system prompt presence", () => {
    const context = extractContext(
      {
        model: "test",
        messages: [
          { role: "system", content: "You are helpful" },
          { role: "user", content: "hi" },
        ],
      },
      new Headers(),
    );

    expect(context.systemSummary).toBe("You are helpful");
    expect(context.userMessage).toBe("hi");
  });

  it("truncates long system prompt summary", () => {
    const longPrompt = "x".repeat(600);
    const context = extractContext(
      {
        model: "test",
        messages: [
          { role: "system", content: longPrompt },
          { role: "user", content: "hi" },
        ],
      },
      new Headers(),
    );

    expect(context.systemSummary).toHaveLength(503);
    expect(context.systemSummary?.endsWith("...")).toBe(true);
  });

  it("extracts media URLs from user message", () => {
    const context = extractContext(
      {
        model: "test",
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "look at this" },
              { type: "image_url", image_url: { url: "https://example.com/photo.jpg" } },
            ],
          },
        ],
      },
      new Headers(),
    );

    expect(context.mediaUrls).toEqual(["https://example.com/photo.jpg"]);
    expect(context.userMessage).toBe("look at this");
  });

  it("returns undefined systemSummary for whitespace-only system prompt", () => {
    const context = extractContext(
      {
        model: "test",
        messages: [
          { role: "system", content: "   " },
          { role: "user", content: "hi" },
        ],
      },
      new Headers(),
    );

    expect(context.systemSummary).toBeUndefined();
  });

  it("returns undefined systemSummary for empty system prompt", () => {
    const context = extractContext(
      {
        model: "test",
        messages: [
          { role: "system", content: "" },
          { role: "user", content: "hi" },
        ],
      },
      new Headers(),
    );

    expect(context.systemSummary).toBeUndefined();
  });

  it("filters malformed image_url blocks with missing url", () => {
    const urls = extractMediaUrls([
      { type: "image_url", image_url: {} as { url: string } },
      { type: "image_url", image_url: { url: "https://valid.com/img.jpg" } },
    ]);

    expect(urls).toEqual(["https://valid.com/img.jpg"]);
  });

  it("extracts conversation history", () => {
    const context = extractContext(
      {
        model: "test",
        messages: [
          { role: "system", content: "sys" },
          { role: "user", content: "first" },
          { role: "assistant", content: "reply" },
          { role: "user", content: "second" },
        ],
      },
      new Headers(),
    );

    expect(context.userMessage).toBe("second");
    expect(context.history).toHaveLength(2);
  });

  it("excludes trailing messages after last user message from history", () => {
    const context = extractContext(
      {
        model: "test",
        messages: [
          { role: "system", content: "sys" },
          { role: "user", content: "ask" },
          { role: "assistant", content: "answer" },
          { role: "user", content: "follow-up" },
          { role: "assistant", content: "trailing" },
        ],
      },
      new Headers(),
    );

    expect(context.userMessage).toBe("follow-up");
    expect(context.history).toHaveLength(2);

    const historyTexts = context.history.map((message) =>
      typeof message.content === "string" ? message.content : "",
    );
    expect(historyTexts).toContain("ask");
    expect(historyTexts).toContain("answer");
    expect(historyTexts).not.toContain("follow-up");
    expect(historyTexts).not.toContain("trailing");
  });

  it("handles assistant-only messages (no user message)", () => {
    const context = extractContext(
      {
        model: "test",
        messages: [{ role: "assistant", content: "previous reply" }],
      },
      new Headers(),
    );

    expect(context.userMessage).toBe("");
    expect(context.history).toHaveLength(0);
  });

  it("handles empty messages array", () => {
    const context = extractContext({ model: "test", messages: [] }, new Headers());

    expect(context.userMessage).toBe("");
    expect(context.history).toHaveLength(0);
    expect(context.channel).toBeUndefined();
  });

  it("extracts channel metadata from headers", () => {
    const headers = new Headers({
      "x-openclaw-message-channel": "telegram",
      "x-openclaw-account-id": "user-123",
    });

    const context = extractContext(
      { model: "test", messages: [{ role: "user", content: "hi" }] },
      headers,
    );

    expect(context.channel).toBe("telegram");
    expect(context.accountId).toBe("user-123");
  });

  it("handles missing headers gracefully", () => {
    const context = extractContext(
      { model: "test", messages: [{ role: "user", content: "hi" }] },
      new Headers(),
    );

    expect(context.channel).toBeUndefined();
    expect(context.accountId).toBeUndefined();
  });
});

function makeContext(overrides: Partial<RequestContext> & { userMessage: string }): RequestContext {
  return {
    history: [],
    mediaUrls: [],
    systemSummary: undefined,
    channel: undefined,
    accountId: undefined,
    ...overrides,
  };
}

describe("formatNotificationContent", () => {
  it("formats with channel prefix", () => {
    const result = formatNotificationContent(
      makeContext({ userMessage: "hello", channel: "telegram", accountId: "lexfrei" }),
    );

    expect(result).toContain("[telegram/lexfrei]");
    expect(result).toContain("hello");
  });

  it("formats without prefix when no metadata", () => {
    const result = formatNotificationContent(makeContext({ userMessage: "hello" }));

    expect(result).toBe("hello");
  });

  it("formats with channel only", () => {
    const result = formatNotificationContent(
      makeContext({ userMessage: "hi", channel: "discord" }),
    );

    expect(result).toContain("[discord]");
    expect(result).not.toContain("/");
  });

  it("formats with accountId only", () => {
    const result = formatNotificationContent(
      makeContext({ userMessage: "hi", accountId: "user-1" }),
    );

    expect(result).toContain("[user-1]");
  });

  it("truncates history to last 3 with omitted count", () => {
    const history = [
      { role: "user" as const, content: "msg1" },
      { role: "assistant" as const, content: "reply1" },
      { role: "user" as const, content: "msg2" },
      { role: "assistant" as const, content: "reply2" },
      { role: "user" as const, content: "msg3" },
    ];

    const result = formatNotificationContent(makeContext({ userMessage: "latest", history }));

    expect(result).toContain("[2 earlier messages omitted]");
    expect(result).toContain("msg3");
    expect(result).not.toContain("msg1");
  });

  it("includes recent history in content", () => {
    const result = formatNotificationContent(
      makeContext({
        userMessage: "latest",
        history: [
          { role: "user", content: "first" },
          { role: "assistant", content: "reply" },
        ],
      }),
    );

    expect(result).toContain("Conversation context:");
    expect(result).toContain("user: first");
    expect(result).toContain("latest");
  });

  it("includes image URLs in content", () => {
    const result = formatNotificationContent(
      makeContext({
        userMessage: "check this",
        mediaUrls: ["https://example.com/photo.jpg"],
      }),
    );

    expect(result).toContain("[Image: https://example.com/photo.jpg]");
    expect(result).toContain("check this");
  });

  it("includes system prompt summary", () => {
    const result = formatNotificationContent(
      makeContext({
        userMessage: "hello",
        systemSummary: "You are a helpful assistant",
      }),
    );

    expect(result).toContain("[Agent context: You are a helpful assistant]");
  });
});

describe("buildNotificationMeta", () => {
  it("includes channel and accountId when present", () => {
    const meta = buildNotificationMeta(
      makeContext({
        userMessage: "hi",
        history: [{ role: "user", content: "old" }],
        channel: "telegram",
        accountId: "user-1",
      }),
    );

    expect(meta["channel"]).toBe("telegram");
    expect(meta["accountId"]).toBe("user-1");
  });

  it("omits undefined fields", () => {
    const meta = buildNotificationMeta(makeContext({ userMessage: "hi" }));

    expect(meta["channel"]).toBeUndefined();
    expect(meta["accountId"]).toBeUndefined();
  });
});
