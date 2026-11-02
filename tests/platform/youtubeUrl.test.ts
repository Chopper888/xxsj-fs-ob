import { describe, expect, it } from "vitest";
import { buildYouTubeIdentity, isYouTubeUrl, parseYouTubeUrl } from "../../src/platform/youtube/youtubeUrl.js";

describe("YouTube 链接解析", () => {
  it("识别 youtube.com/watch?v= 并提取 videoId", () => {
    expect(parseYouTubeUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toEqual({ videoId: "dQw4w9WgXcQ" });
    expect(parseYouTubeUrl("https://youtube.com/watch?v=dQw4w9WgXcQ&t=12s")).toEqual({ videoId: "dQw4w9WgXcQ" });
  });

  it("识别 youtu.be 短链", () => {
    expect(parseYouTubeUrl("https://youtu.be/dQw4w9WgXcQ")).toEqual({ videoId: "dQw4w9WgXcQ" });
    expect(parseYouTubeUrl("https://youtu.be/dQw4w9WgXcQ?si=abc")).toEqual({ videoId: "dQw4w9WgXcQ" });
  });

  it("拒绝非法域名、非法 ID、非 watch 路径", () => {
    expect(() => parseYouTubeUrl("https://example.com/watch?v=dQw4w9WgXcQ")).toThrow();
    expect(() => parseYouTubeUrl("https://www.youtube.com/watch?v=short")).toThrow();
    expect(() => parseYouTubeUrl("https://youtu.be/not_an_id")).toThrow();
    expect(() => parseYouTubeUrl("https://www.youtube.com/feed/trending")).toThrow();
    expect(() => parseYouTubeUrl("not a url")).toThrow();
  });
});

describe("isYouTubeUrl", () => {
  it("返回 true 覆盖 watch / youtu.be / 带查询参数", () => {
    expect(isYouTubeUrl("https://youtube.com/watch?v=dQw4w9WgXcQ")).toBe(true);
    expect(isYouTubeUrl("https://youtu.be/dQw4w9WgXcQ")).toBe(true);
    expect(isYouTubeUrl("https://m.youtube.com/watch?v=dQw4w9WgXcQ&feature=share")).toBe(true);
    expect(isYouTubeUrl("https://music.youtube.com/watch?v=dQw4w9WgXcQ")).toBe(true);
  });

  it("拒绝非 YouTube 或无效 ID", () => {
    expect(isYouTubeUrl("https://www.bilibili.com/video/BV1Wy4y167Z9/")).toBe(false);
    expect(isYouTubeUrl("https://www.youtube.com/watch?v=xyz")).toBe(false);
    expect(isYouTubeUrl("https://youtu.be/")).toBe(false);
  });
});

describe("buildYouTubeIdentity", () => {
  it("构建 canonical / 去重键", () => {
    expect(buildYouTubeIdentity("https://youtu.be/dQw4w9WgXcQ")).toMatchObject({
      platform: "youtube",
      platformContentId: "dQw4w9WgXcQ",
      canonicalUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      dedupeKey: "youtube:dQw4w9WgXcQ",
    });
  });
});
