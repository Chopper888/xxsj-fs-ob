import type { ContentType, SummaryResult } from "../domain/types.js";

interface SummaryPrompt {
  title: string;
  text: string;
  contentType: ContentType;
}

interface SummaryClient {
  summarizeText(prompt: SummaryPrompt): Promise<SummaryResult>;
}

type FetchLike = typeof fetch;

interface OpenAICompatibleSummaryClientOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  fetchImpl?: FetchLike;
}

function parseSummaryResult(content: string): SummaryResult {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const parsed = JSON.parse(fenced?.[1] ?? content) as Partial<SummaryResult>;
  return {
    summary: String(parsed.summary ?? ""),
    suggestedCategory: String(parsed.suggestedCategory ?? "未分类"),
  };
}

export function buildChatCompletionsUrl(baseUrl: string): string {
  const parsed = new URL(baseUrl.trim());
  let path = parsed.pathname.replace(/\/+$/, "");
  path = path.replace(/(?:\/v1){2,}$/, "/v1");
  if (parsed.hostname === "api.deepseek.com" && !path) path = "/v1";
  if (!path.endsWith("/chat/completions")) path += "/chat/completions";
  parsed.pathname = path;
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString().replace(/\/$/, "");
}

export class OpenAICompatibleSummaryClient implements SummaryClient {
  private readonly fetchImpl: FetchLike;

  constructor(private readonly options: OpenAICompatibleSummaryClientOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async completeJson(systemPrompt: string, payload: unknown): Promise<string> {
    const response = await this.fetchImpl(buildChatCompletionsUrl(this.options.baseUrl), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.options.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.options.model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: JSON.stringify(payload) },
        ],
        temperature: 0.2,
        response_format: { type: "json_object" },
      }),
    });
    if (!response.ok) throw new Error(`summary_request_failed:${response.status}`);
    const body = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = body.choices?.[0]?.message?.content;
    if (!content) throw new Error("summary_response_empty");
    return content;
  }

  async summarizeText(prompt: SummaryPrompt): Promise<SummaryResult> {
    const systemPrompt =
      "你是个人知识库整理助手。请只输出 JSON，不要输出 Markdown。字段必须是 summary, suggestedCategory。" +
      "summary 用中文，100-180 字，直接说明内容价值和适用场景。" +
      "suggestedCategory 输出一个短分类。" +
      "如果 contentType 是 video，text 是语音转写，可能有错别字；请按上下文纠错后总结，不要逐字复述。";
    const content = await this.completeJson(systemPrompt, {
      title: prompt.title, contentType: prompt.contentType, text: prompt.text,
    });
    return parseSummaryResult(content);
  }
}
