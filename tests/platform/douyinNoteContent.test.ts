import { describe, expect, it } from "vitest";
import { classifyDouyinNoteContent, extractDouyinAwemeId, isDouyinArticleUrl, isDouyinNoteOrArticleUrl, isDouyinNoteUrl } from "../../src/platform/douyin/douyinNoteContent.js";

describe("extractDouyinAwemeId", () => {
  it.each([
    ["https://www.douyin.com/video/7650000000000000000", "7650000000000000000"],
    ["https://www.douyin.com/note/7640701464617132402", "7640701464617132402"],
    ["https://www.douyin.com/article/7650000000000000000", "7650000000000000000"],
    ["https://www.douyin.com/jingxuan?modal_id=7650000000000000000", "7650000000000000000"],
    ["https://m.douyin.com/share/note/7640701464617132402", "7640701464617132402"],
  ])("extracts id from %s", (url, expected) => {
    expect(extractDouyinAwemeId(url)).toBe(expected);
  });

  it("returns undefined for non-content douyin urls (host check 在 canHandle 层)", () => {
    expect(extractDouyinAwemeId("https://www.douyin.com/user/abc123")).toBeUndefined();
    expect(extractDouyinAwemeId("https://www.douyin.com/discover")).toBeUndefined();
  });
});

describe("douyin note/article url helpers", () => {
  it("isDouyinNoteUrl", () => {
    expect(isDouyinNoteUrl("https://www.douyin.com/note/7650000000000000000")).toBe(true);
    expect(isDouyinNoteUrl("https://www.douyin.com/video/7650000000000000000")).toBe(false);
  });
  it("isDouyinArticleUrl", () => {
    expect(isDouyinArticleUrl("https://www.douyin.com/article/7650000000000000000")).toBe(true);
    expect(isDouyinArticleUrl("https://www.douyin.com/note/7650000000000000000")).toBe(false);
  });
  it("isDouyinNoteOrArticleUrl", () => {
    expect(isDouyinNoteOrArticleUrl("https://www.douyin.com/note/7650000000000000000")).toBe(true);
    expect(isDouyinNoteOrArticleUrl("https://www.douyin.com/article/7650000000000000000")).toBe(true);
    expect(isDouyinNoteOrArticleUrl("https://www.douyin.com/video/7650000000000000000")).toBe(false);
  });
});

describe("classifyDouyinNoteContent (字段判定，不依赖 URL/aweme_type)", () => {
  it("images[] 非空 → image_text（图文），即使 video 字段也存在（图集占位）", () => {
    expect(classifyDouyinNoteContent({ ok: true, has_video: true, has_article_info: false, images: [{ uri: "tos/x", url: "https://p.douyinpic.com/x~q75.webp" }] })).toBe("image_text");
  });
  it("无 images + video 存在 → video", () => {
    expect(classifyDouyinNoteContent({ ok: true, has_video: true, has_article_info: false, images: [] })).toBe("video");
  });
  it("无 images + article_info 存在 → article（文章）", () => {
    expect(classifyDouyinNoteContent({ ok: true, has_video: false, has_article_info: true, images: [] })).toBe("article");
  });
  it("无 images 也无 video 也无 article_info → 按 video 处理（交回视频路径诊断）", () => {
    expect(classifyDouyinNoteContent({ ok: true, has_video: false, has_article_info: false, images: [] })).toBe("video");
  });
});
