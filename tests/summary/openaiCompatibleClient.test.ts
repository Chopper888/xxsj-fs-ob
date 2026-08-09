import { describe, expect, it, vi } from "vitest";
import { buildChatCompletionsUrl, OpenAICompatibleSummaryClient } from "../../src/summary/openaiCompatibleClient.js";

describe("OpenAICompatibleSummaryClient", () => {
  it("exposes the raw model content for schema-specific processors", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: '{"custom":true}' } }] }),
    });
    const client = new OpenAICompatibleSummaryClient({
      baseUrl: "https://api.example.com/v1", apiKey: "test-key", model: "test-model",
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    await expect(client.completeJson("system", { input: "safe" })).resolves.toBe('{"custom":true}');
  });
  it("normalizes DeepSeek chat completion URLs without duplicating or omitting v1", () => {
    expect(buildChatCompletionsUrl("https://api.deepseek.com")).toBe("https://api.deepseek.com/v1/chat/completions");
    expect(buildChatCompletionsUrl("https://api.deepseek.com/v1")).toBe("https://api.deepseek.com/v1/chat/completions");
    expect(buildChatCompletionsUrl("https://api.deepseek.com/v1/v1/")).toBe("https://api.deepseek.com/v1/chat/completions");
    expect(buildChatCompletionsUrl("https://api.deepseek.com/v1/chat/completions")).toBe("https://api.deepseek.com/v1/chat/completions");
  });
  it("parses structured JSON summaries", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                summary: "总结",
                suggestedCategory: "分类",
              }),
            },
          },
        ],
      }),
    });

    const client = new OpenAICompatibleSummaryClient({
      baseUrl: "https://api.example.com/v1",
      apiKey: "test-key",
      model: "test-model",
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    await expect(
      client.summarizeText({
        title: "标题",
        text: "正文",
        contentType: "text",
      }),
    ).resolves.toEqual({
      summary: "总结",
      suggestedCategory: "分类",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.com/v1/chat/completions",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer test-key",
          "Content-Type": "application/json",
        }),
      }),
    );

    const request = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(request).toBeDefined();
    const body = JSON.parse(String(request?.body)) as {
      model?: string;
      messages?: Array<{ role?: string; content?: string }>;
      temperature?: number;
    };

    expect(body.model).toBe("test-model");
    expect(body.temperature).toBe(0.2);
    expect(body.messages?.[0]?.role).toBe("system");
    expect(body.messages?.[0]?.content).toContain("字段必须是 summary, suggestedCategory");
    expect(body.messages?.[0]?.content).toContain("如果 contentType 是 video");
    expect(body.messages?.[1]?.role).toBe("user");
    expect(JSON.parse(String(body.messages?.[1]?.content))).toEqual({
      title: "标题",
      contentType: "text",
      text: "正文",
    });
  });

  it("parses JSON returned in fenced markdown blocks", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: '```json\n{"summary":"总结","suggestedCategory":"分类"}\n```',
            },
          },
        ],
      }),
    });

    const client = new OpenAICompatibleSummaryClient({
      baseUrl: "https://api.example.com/v1",
      apiKey: "test-key",
      model: "test-model",
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    await expect(client.summarizeText({ title: "标题", text: "正文", contentType: "video" })).resolves.toEqual({
      summary: "总结",
      suggestedCategory: "分类",
    });
  });
});
