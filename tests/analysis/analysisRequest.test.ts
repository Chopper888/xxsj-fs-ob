import { describe, expect, it } from "vitest";
import { buildDouyinAnalysisRequest } from "../../src/analysis/analysisRequest.js";

describe("analysis request compatibility", () => {
  it("maps neutral AnalysisInput to the unchanged Douyin request shape", () => {
    expect(buildDouyinAnalysisRequest({ sourceRecordId: "rec1", platform: "douyin", canonicalUrl: "https://www.douyin.com/video/123", title: "标题", primaryText: "ASR正文", contextTexts: [], provenance: { platformContentId: "123", dedupeKey: "douyin:123" } }, { sourcePlatform: "抖音", model: "deepseek-chat", segmentCount: 7 })).toEqual({ source_record_id: "rec1", title: "标题", source_platform: "抖音", source_url: "https://www.douyin.com/video/123", whisper: { transcript: "ASR正文", segment_count: 7 }, required_provenance: { source_record_id: "rec1", source_platform: "抖音", processor: "local-ai-analysis", model: "deepseek-chat", processor_version: "1.0.0" } });
  });
});
