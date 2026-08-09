import { describe, expect, it } from "vitest";
import { renderMarkdownPreview, sanitizeWindowsFileName } from "../../src/preview/markdownPreview.js";

const transcript = "很多视频收藏了却再没时间细看。\n\n每晚十一点，新增收藏自动变成知识库文档。";
const input = {
  title: "抖音收藏每日自动转知识库",
  author: "实际作者",
  platform: "抖音",
  originalUrl: "https://www.douyin.com/video/7666820150208875814",
  resolvedDownloadUrl: "https://aweme.snssdk.com/aweme/v1/play/?video_id=real",
  resolvedAt: "2026-08-03T01:02:03.000Z",
  downloadUrlStatus: "available" as const,
  localMediaPath: "/tmp/xxsj-test-project/data/tasks/rec1/media/source.mp4",
  workId: "7666820150208875814",
  publishedAt: "2026-07-26T16:58:00+08:00",
  collectedAt: "2026-08-02T04:42:38+08:00",
  primaryCategory: "Skill/插件/模型",
  secondaryCategory: "知识库自动化/信息收集",
  baseRecordId: "rec1",
  dedupeId: "douyin:7666820150208875814",
  transcriber: "whisper-base",
  analyzer: "deepseek-chat",
  reviewStatus: "needs_review" as const,
  videoSummary: "视频介绍如何把每日新增的抖音收藏自动整理为知识库文档。",
  transcript,
  corrections: [{ original: "Skyo", suggestion: "Skill", reason: "标题和上下文", confidence: "medium" as const, evidence: ["title", "context"], approved: false, review_note: "" }],
  processedAt: "2026-08-03T01:03:00.000Z",
};

describe("Markdown preview", () => {
  it("renders parseable frontmatter and the complete unmodified transcript", () => {
    const markdown = renderMarkdownPreview(input);
    expect(markdown.startsWith("---\n")).toBe(true);
    expect(markdown.match(/^---$/gm)).toHaveLength(2);
    expect(markdown).toContain(`## 完整逐字稿\n\n${transcript}\n\n## 转写待确认`);
    expect(markdown).toContain('original_url: "https://www.douyin.com/video/7666820150208875814"');
    expect(markdown).toContain('resolved_download_url: "https://aweme.snssdk.com/aweme/v1/play/?video_id=real"');
    expect(markdown).toContain('published_at: "2026-07-26T16:58:00+08:00"');
    expect(markdown).toContain('collected_at: "2026-08-02T04:42:38+08:00"');
  });

  it("keeps unapproved corrections out of the transcript body", () => {
    const markdown = renderMarkdownPreview(input);
    const body = markdown.split("## 完整逐字稿\n\n")[1]!.split("\n\n## 转写待确认")[0]!;
    expect(body).toBe(transcript);
    expect(markdown).toContain("`Skyo` → `Skill`");
  });

  it("marks a missing direct URL instead of inventing one", () => {
    const markdown = renderMarkdownPreview({ ...input, resolvedDownloadUrl: "", downloadUrlStatus: "unknown" });
    expect(markdown).toContain('resolved_download_url: ""');
    expect(markdown).toContain("- 视频直接下载链接：无（未取得或已失效）");
  });

  it("includes local media and no credential-bearing fields", () => {
    const markdown = renderMarkdownPreview(input);
    expect(markdown).toContain(input.localMediaPath);
    for (const forbidden of ["Authorization:", "Bearer ", "API Key", "Cookie:"]) expect(markdown).not.toContain(forbidden);
  });

  it("sanitizes Windows-invalid filename characters deterministically", () => {
    expect(sanitizeWindowsFileName('标题:测试/预览?*<>|"')).toBe("标题_测试_预览______");
    expect(sanitizeWindowsFileName('标题:测试/预览?*<>|"')).toBe(sanitizeWindowsFileName('标题:测试/预览?*<>|"'));
  });
});
