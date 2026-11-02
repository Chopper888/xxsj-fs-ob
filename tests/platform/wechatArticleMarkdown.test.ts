import { describe, expect, it } from "vitest";
import { buildWechatArticleMarkdown } from "../../src/platform/wechat/wechatArticleMarkdown.js";

describe("WeChat article Markdown", () => {
  it("keeps AI output separate from the normalized original body", () => {
    const markdown = buildWechatArticleMarkdown({ recordId: "rec123456789", content: { identity: { platform: "wechat_official_account", platformContentId: "w1", sourceUrl: "https://mp.weixin.qq.com/s/a", canonicalUrl: "https://mp.weixin.qq.com/s/a", dedupeKey: "wechat:w1" }, contentType: "article", title: "原题", author: { name: "原公众号" }, publishedAt: "2026-08-01", texts: [{ kind: "body", role: "primary", text: "原文章正文内容" }], media: [], links: [] }, analysis: { summary: "AI摘要", key_points: ["AI要点"], primary_category: "其他", secondary_category: "", useful_information: ["信息"], action_items: [], transcript_corrections: [], quality_warnings: [], source_record_id: "rec123456789", source_platform: "公众号", processor: "local-ai-analysis", model: "deepseek-chat", processor_version: "1.0.0" }, assets: [], warnings: [], processedAt: "2026-08-14T00:00:00+08:00" });
    expect(markdown).toContain("## AI 摘要"); expect(markdown).toContain("## 原文正文"); expect(markdown).toContain("原文章正文内容"); expect(markdown).not.toContain("逐字稿");
  });
});

