import { describe, expect, it } from "vitest";
import { extractCapturedItem } from "../../src/domain/extractor.js";

describe("extractCapturedItem", () => {
  it("classifies Douyin video cards", () => {
    const item = extractCapturedItem({
      snapshotId: "m1",
      text: "张三 分享了一个视频\nTypeScript 入门教程",
      html: '<a href="https://www.douyin.com/video/7650000000000000000">video</a>',
      links: ["https://www.douyin.com/video/7650000000000000000"],
      images: ["https://example.com/cover.jpg"],
      timestamp: "2026-07-03T10:00:00.000Z",
    });

    expect(item.type).toBe("video");
    expect(item.url).toBe("https://www.douyin.com/jingxuan?modal_id=7650000000000000000");
    expect(item.title).toBe("TypeScript 入门教程");
  });

  it("classifies image-text posts", () => {
    const item = extractCapturedItem({
      snapshotId: "m2",
      text: "这是一篇关于提示词工程的图文笔记",
      html: '<img src="https://example.com/a.jpg">',
      links: [],
      images: ["https://example.com/a.jpg"],
    });

    expect(item.type).toBe("image_text");
    expect(item.title).toBe("这是一篇关于提示词工程的图文笔记");
  });

  it("classifies Douyin message preview video text", () => {
    const item = extractCapturedItem({
      snapshotId: "m1-preview",
      text: "示例用户15:55分享[视频]",
      html: "<div>示例用户15:55分享[视频]</div>",
      links: [],
      images: [],
    });

    expect(item.type).toBe("video");
    expect(item.title).toBe("分享视频");
  });

  it("classifies Douyin message preview links", () => {
    const item = extractCapturedItem({
      snapshotId: "m-link-preview",
      text: "示例账号前天分享[链接]：ai替我提前下班",
      html: "<div>示例账号前天分享[链接]：ai替我提前下班</div>",
      links: [],
      images: [],
    });

    expect(item.type).toBe("link");
    expect(item.title).toBe("ai替我提前下班");
  });

  it("classifies Douyin chat detail share cards", () => {
    const item = extractCapturedItem({
      snapshotId: "m-card",
      text: "示例作者",
      html: '<div class="MessageItemShareAwemecontainer"><img src="cover.jpg"><p class="MessageItemShareAwemeautorName">示例作者</p></div>',
      links: [],
      images: ["cover.jpg"],
    });

    expect(item.type).toBe("video");
    expect(item.title).toBe("示例作者 分享的视频");
    expect(item.text).toBe("");
    expect(item.author).toBe("示例作者");
  });

  it("does not use noisy chat text as a video share card title", () => {
    const item = extractCapturedItem({
      snapshotId: "m-card-noisy-title",
      text: [
        "示例用户 会话甲 刚刚 视频无法查看",
        "39分钟前 会话乙 昨天 22:27",
        "示例作者 昨天 21:32 你撤回了一条消息",
        "昨天 21:20 会话丙 昨天 11:48 你撤回了一条消息",
      ].join("\n"),
      html: '<div class="MessageItemShareAwemecontainer"><span class="MessageItemShareAwemeautorName">会话甲</span></div>',
      links: ["https://www.douyin.com/jingxuan?modal_id=7650000000000000001"],
      images: ["cover.jpg"],
    });

    expect(item.type).toBe("video");
    expect(item.url).toBe("https://www.douyin.com/jingxuan?modal_id=7650000000000000001");
    expect(item.title).toBe("会话甲 分享的视频");
    expect(item.author).toBe("会话甲");
  });

  it("does not use generic Douyin page metadata as a video title", () => {
    const item = extractCapturedItem({
      snapshotId: "m-card-generic-title",
      title: "海量优质视频内容，涵盖游戏、二次元、美食、音乐、知识、体育运动、旅行、生活等各类题材，系列合集内容连续看，有用又有趣，无论是休闲解压、消遣下饭，还是发现爱好、获取知识，你想要的好内容，都在抖音精选。",
      text: "示例频道",
      html: '<div class="MessageItemShareAwemecontainer"><span class="MessageItemShareAwemeautorName">示例频道</span></div>',
      links: ["https://www.douyin.com/jingxuan?modal_id=7650000000000000002"],
      images: ["cover.jpg"],
    });

    expect(item.title).toBe("示例频道 分享的视频");
    expect(item.author).toBe("示例频道");
  });

  it("uses Douyin modal title over chat card author text", () => {
    const item = extractCapturedItem({
      snapshotId: "m-card-title",
      title: "如何用 AI 做自动化知识库",
      text: "示例作者",
      html: '<div class="MessageItemShareAwemecontainer"><img src="cover.jpg"><p class="MessageItemShareAwemeautorName">示例作者</p></div>',
      links: ["https://www.douyin.com/jingxuan?modal_id=7650000000000000000"],
      images: ["cover.jpg"],
    });

    expect(item.type).toBe("video");
    expect(item.url).toBe("https://www.douyin.com/jingxuan?modal_id=7650000000000000000");
    expect(item.title).toBe("如何用 AI 做自动化知识库");
    expect(item.text).toBe("");
    expect(item.author).toBe("示例作者");
  });

  it("moves standalone share-card author text into author field", () => {
    const item = extractCapturedItem({
      snapshotId: "m-card-author",
      title: "键盘消失转场效果教学 #剪辑教程 #创意拍摄",
      text: "示例作者",
      html: '<div class="MessageItemShareAwemecontainer"><span class="MessageItemShareAwemeautorName">@示例作者</span></div>',
      links: ["https://www.douyin.com/jingxuan?modal_id=765"],
      images: ["cover.jpg"],
    });

    expect(item.title).toBe("键盘消失转场效果教学 #剪辑教程 #创意拍摄");
    expect(item.text).toBe("");
    expect(item.author).toBe("示例作者");
  });

  it("classifies plain text", () => {
    const item = extractCapturedItem({
      snapshotId: "m3",
      text: "记得研究一下 RAG 的召回评估。",
      html: "<div>记得研究一下 RAG 的召回评估。</div>",
      links: [],
      images: [],
    });

    expect(item.type).toBe("text");
    expect(item.text).toContain("RAG");
  });

  it("marks empty cards as unknown", () => {
    const item = extractCapturedItem({
      snapshotId: "m4",
      text: "",
      html: "<div></div>",
      links: [],
      images: [],
    });

    expect(item.type).toBe("unknown");
    expect(item.title).toBe("未识别内容");
  });
});
