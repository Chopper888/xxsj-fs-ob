import type { CapturedItem, ContentType, SummaryResult } from "../domain/types.js";

export interface SummaryPrompt {
  title: string;
  text: string;
  contentType: ContentType;
}

export interface SummaryClient {
  summarizeText(prompt: SummaryPrompt): Promise<SummaryResult>;
}

export async function summarizeCapturedItem(
  item: CapturedItem,
  client: SummaryClient,
): Promise<SummaryResult | undefined> {
  if (item.type !== "text" && item.type !== "image_text" && item.type !== "video") {
    return undefined;
  }

  const text = item.type === "video" ? item.text || item.title : item.text;
  if (!text.trim() && !item.title.trim()) return undefined;

  return client.summarizeText({
    title: item.title,
    text,
    contentType: item.type,
  });
}

export class MockSummaryClient implements SummaryClient {
  async summarizeText(prompt: SummaryPrompt): Promise<SummaryResult> {
    const compact = prompt.text.replace(/\s+/g, " ").trim();
    const summary = compact.length > 80 ? `${compact.slice(0, 80)}...` : compact;

    return {
      summary: summary || prompt.title,
      suggestedCategory: "未分类",
    };
  }
}
