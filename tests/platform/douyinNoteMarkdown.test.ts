import { describe, expect, it } from "vitest";
import { buildDouyinNoteMarkdown } from "../../src/platform/douyin/douyinNoteMarkdown.js";
import type { NormalizedContent } from "../../src/platform/types.js";
import type { ContentAnalysisResult } from "../../src/analysis/contentAnalysis.js";
import type { WechatLocalAsset } from "../../src/platform/wechat/wechatAssetMaterializer.js";

const content: NormalizedContent = {
  identity: { platform: "douyin", platformContentId: "7640701464617132402", sourceUrl: "https://www.douyin.com/note/7640701464617132402", canonicalUrl: "https://www.douyin.com/note/7640701464617132402", dedupeKey: "douyin:7640701464617132402" },
  contentType: "article",
  title: "5.17初中数学教资面试真题",
  author: { name: "李饭饭的饭" },
  publishedAt: "2026-05-17T00:00:00.000Z",
  texts: [{ kind: "body", role: "primary", text: "完整题本都在里面 #教资" }],
  media: [{ kind: "image", role: "context", sourceUrl: "https://p.douyinpic.com/x~q75.webp", order: 1 }],
  links: [{ url: "https://www.douyin.com/note/7640701464617132402", role: "source" }],
};

const analysis: ContentAnalysisResult = {
  summary: "教资面试真题合集", key_points: ["包含题本"], primary_category: "AI行业动态/资讯", secondary_category: "", useful_information: [], action_items: [], transcript_corrections: [], quality_warnings: [],
  source_record_id: "rec1", source_platform: "抖音", processor: "local-ai-analysis", model: "deepseek-chat", processor_version: "1.0.0",
};

const assets: WechatLocalAsset[] = [{ sourceUrl: "https://p.douyinpic.com/x~q75.webp", localPath: "assets/001-abc.webp", markdownPath: "assets/001-abc.webp", order: 1, contentType: "image/webp", bytes: 100 }];

describe("buildDouyinNoteMarkdown", () => {
  it("renders frontmatter + 配文 + 图片引用", () => {
    const md = buildDouyinNoteMarkdown({ recordId: "rec1", content, analysis, assets, warnings: [], processedAt: "2026-08-31T00:00:00.000Z" });
    expect(md).toContain("platform: 抖音");
    expect(md).toContain("note_id: \"7640701464617132402\"");
    expect(md).toContain("## 图文配文");
    expect(md).toContain("完整题本都在里面 #教资");
    expect(md).toContain("## 原文图片");
    expect(md).toContain("![图片 1](assets/001-abc.webp)");
    expect(md).toContain("## AI 摘要");
  });
});
