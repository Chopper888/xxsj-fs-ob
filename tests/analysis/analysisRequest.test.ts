import { describe, expect, it } from "vitest";
import { buildDouyinAnalysisRequest } from "../../src/analysis/analysisRequest.js";
import { buildVideoAnalysisSystemPrompt } from "../../src/analysis/contentAnalysis.js";

describe("analysis request compatibility", () => {
  it("maps neutral AnalysisInput to the unchanged Douyin request shape", () => {
    expect(buildDouyinAnalysisRequest({ sourceRecordId: "rec1", platform: "douyin", canonicalUrl: "https://www.douyin.com/video/123", title: "标题", primaryText: "ASR正文", contextTexts: [], provenance: { platformContentId: "123", dedupeKey: "douyin:123" } }, { sourcePlatform: "抖音", model: "deepseek-chat", segmentCount: 7 })).toEqual({ source_record_id: "rec1", title: "标题", source_platform: "抖音", source_url: "https://www.douyin.com/video/123", whisper: { transcript: "ASR正文", segment_count: 7 }, required_provenance: { source_record_id: "rec1", source_platform: "抖音", processor: "local-ai-analysis", model: "deepseek-chat", processor_version: "1.0.0" } });
  });
});
it("B站视频 prompt 区分官方字幕与 ASR 且不使用公众号语义",()=>{const subtitle=buildVideoAnalysisSystemPrompt(["其他"],"subtitle-first");const asr=buildVideoAnalysisSystemPrompt(["其他"],"media-first");expect(subtitle).toContain("官方字幕");expect(asr).toContain("ASR 转写");expect(subtitle).not.toContain("公众号")});
