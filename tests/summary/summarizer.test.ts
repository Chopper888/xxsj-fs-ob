import { describe, expect, it, vi } from "vitest";
import type { CapturedItem, SummaryResult } from "../../src/domain/types.js";
import { summarizeCapturedItem } from "../../src/summary/summarizer.js";

const textItem: CapturedItem = {
  type: "text",
  title: "RAG 评估",
  text: "RAG 系统需要同时评估召回率和答案忠实度。",
  rawSnapshot: "{}",
};

describe("summarizeCapturedItem", () => {
  it("summarizes text-like content", async () => {
    const expected: SummaryResult = {
      summary: "说明 RAG 评估需要覆盖召回与忠实度。",
      suggestedCategory: "AI",
    };

    const client = {
      summarizeText: vi.fn().mockResolvedValue(expected),
    };

    await expect(summarizeCapturedItem(textItem, client)).resolves.toEqual(expected);
    expect(client.summarizeText).toHaveBeenCalledWith({
      title: "RAG 评估",
      text: "RAG 系统需要同时评估召回率和答案忠实度。",
      contentType: "text",
    });
  });

  it("summarizes videos from resolved title or description metadata", async () => {
    const expected: SummaryResult = {
      summary: "概括视频讲解 RAG 评估方法。",
      suggestedCategory: "AI",
    };
    const client = {
      summarizeText: vi.fn().mockResolvedValue(expected),
    };

    await expect(
      summarizeCapturedItem(
        {
          ...textItem,
          type: "video",
          title: "RAG 评估教程：召回率和答案忠实度",
          text: "",
        },
        client,
      ),
    ).resolves.toEqual(expected);
    expect(client.summarizeText).toHaveBeenCalledWith({
      title: "RAG 评估教程：召回率和答案忠实度",
      text: "RAG 评估教程：召回率和答案忠实度",
      contentType: "video",
    });
  });
});
