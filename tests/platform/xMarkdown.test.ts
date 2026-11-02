import { describe, expect, it } from "vitest";
import { buildXMarkdown } from "../../src/platform/x/xMarkdown.js";
import { buildXIdentity } from "../../src/platform/x/xUrl.js";
import type { NormalizedContent } from "../../src/platform/types.js";
import type { WechatLocalAsset } from "../../src/platform/wechat/wechatAssetMaterializer.js";

const content: NormalizedContent = { identity: buildXIdentity("https://x.com/alice/status/123"), contentType: "post", author: { name: "Alice" }, publishedAt: "2026-08-14", texts: [{ kind: "body", role: "primary", text: "正文" }], media: [], links: [], sourceMetadata: { handle: "alice", mediaHint: true } };
const analysis = { summary: "摘要", key_points: ["要点"], primary_category: "其他", secondary_category: "", useful_information: ["信息"], action_items: [], transcript_corrections: [], quality_warnings: [], source_record_id: "rec", source_platform: "推特", processor: "local-ai-analysis", model: "m", processor_version: "1.0.0" };
const asset: WechatLocalAsset = { sourceUrl: "https://pbs.twimg.com/media/a.jpg", localPath: "x", markdownPath: "_assets/hash16/001-a.jpg", order: 1, contentType: "image/jpeg", bytes: 10 };

describe("buildXMarkdown 图片归档", () => {
  it("本地图片引用 + 原始 URL 溯源 + frontmatter image_source_urls，且不再提示未归档媒体", () => {
    const md = buildXMarkdown({ recordId: "rec", content, analysis, assets: [asset], warnings: [], processedAt: "2026-08-18T00:00:00Z" });
    expect(md).toContain("## 原文图片");
    expect(md).toContain("](_assets/hash16/001-a.jpg)");
    expect(md).toContain("原始图片链接：https://pbs.twimg.com/media/a.jpg");
    expect(md).toContain('image_source_urls: ["https://pbs.twimg.com/media/a.jpg"]');
    expect(md).not.toContain("未稳定提供");
  });
  it("图片全部缺失时保留 mediaHint 提示并输出采集警告", () => {
    const md = buildXMarkdown({ recordId: "rec", content, analysis, assets: [], warnings: ["image_magic_invalid:image/png:deadbeef"], processedAt: "2026-08-18T00:00:00Z" });
    expect(md).not.toContain("## 原文图片");
    expect(md).toContain("## 采集警告");
    expect(md).toContain("请查看原始链接");
  });
  it("传入 transcript 时渲染视频逐字稿与来源", () => {
    const md = buildXMarkdown({ recordId: "rec", content, analysis, assets: [], warnings: [], processedAt: "2026-08-18T00:00:00Z", transcript: { text: "这是转录文本", provider: "qwen-asr" } });
    expect(md).toContain("## 视频逐字稿");
    expect(md).toContain("这是转录文本");
    expect(md).toContain("> 逐字稿来源：qwen-asr 可读化结果，未经人工校正");
  });
  it("无 transcript 时不渲染逐字稿章节", () => {
    const md = buildXMarkdown({ recordId: "rec", content, analysis, assets: [], warnings: [], processedAt: "2026-08-18T00:00:00Z" });
    expect(md).not.toContain("视频逐字稿");
  });
});
