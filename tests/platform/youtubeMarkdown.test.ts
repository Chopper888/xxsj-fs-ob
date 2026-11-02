import { describe, expect, it } from "vitest";
import { buildYouTubeMarkdown } from "../../src/platform/youtube/youtubeMarkdown.js";
import { buildYouTubeIdentity } from "../../src/platform/youtube/youtubeUrl.js";
import type { ContentAnalysisResult } from "../../src/analysis/contentAnalysis.js";
import type { NormalizedContent, PreparedContent } from "../../src/platform/types.js";

const analysis: ContentAnalysisResult = {
  summary: "AI 摘要内容", key_points: ["要点一", "要点二"], primary_category: "其他", secondary_category: "",
  useful_information: ["信息"], action_items: [], transcript_corrections: [],
  quality_warnings: [], source_record_id: "rec123", source_platform: "YouTube",
  processor: "local-ai-analysis", model: "deepseek-chat", processor_version: "1.0.0",
};

const content: NormalizedContent = {
  identity: buildYouTubeIdentity("https://youtu.be/dQw4w9WgXcQ"),
  contentType: "video",
  title: "Rick Astley 官方 MV",
  author: { name: "RickAstleyVEVO" },
  publishedAt: "2024-01-02T00:00:00.000Z",
  texts: [{ kind: "official_subtitle", role: "primary", text: "字幕文本", language: "zh-Hans" }],
  media: [{ kind: "video", role: "context", sourceUrl: "https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg" }],
  links: [{ url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", role: "source" }],
  sourceMetadata: { durationSeconds: 212, subtitleAvailable: true, subtitleLanguage: "zh-Hans" },
};

const prepared: PreparedContent = {
  source: content, preparationMode: "subtitle-first",
  texts: [{ origin: "official_subtitle", role: "primary", text: "字幕文本" }], primaryText: "字幕文本",
};

describe("buildYouTubeMarkdown", () => {
  it("frontmatter 输出平台/作者/标题/时长等字段", () => {
    const md = buildYouTubeMarkdown({ recordId: "rec123", content, prepared, analysis, processedAt: "2026-08-19T00:00:00Z" });
    expect(md).toContain("platform: YouTube");
    expect(md).toContain('author: "RickAstleyVEVO"');
    expect(md).toContain('video_id: "dQw4w9WgXcQ"');
    expect(md).toContain('duration: "3:32"');
    expect(md).toContain('base_record_id: "rec123"');
  });

  it("subtitle-first 标注官方字幕与准备模式", () => {
    const md = buildYouTubeMarkdown({ recordId: "rec123", content, prepared, analysis, processedAt: "2026-08-19T00:00:00Z" });
    expect(md).toContain("## 官方字幕");
    expect(md).toContain("> 转录来源：官方字幕");
    expect(md).toContain("> 内容准备模式：subtitle-first");
    expect(md).not.toContain("## ASR 转写");
    expect(md).toContain("## AI 关键信息");
    expect(md).toContain("- 要点一");
  });

  it("media-first 标注 ASR 转写", () => {
    const mediaPrepared: PreparedContent = {
      source: { ...content, texts: [{ kind: "caption", role: "context", text: "标题" }] }, preparationMode: "media-first",
      texts: [{ origin: "asr", role: "primary", text: "ASR 转写文本", provider: "faster-whisper" }], primaryText: "ASR 转写文本",
      transcript: { text: "ASR 转写文本", provider: "faster-whisper" },
    };
    const md = buildYouTubeMarkdown({ recordId: "rec123", content, prepared: mediaPrepared, analysis, processedAt: "2026-08-19T00:00:00Z" });
    expect(md).toContain("## ASR 转写");
    expect(md).toContain("> 转录来源：ASR 转写");
    expect(md).toContain("> 内容准备模式：media-first");
  });
});
