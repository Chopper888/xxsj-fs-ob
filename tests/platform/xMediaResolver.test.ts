import { describe, it, expect, vi } from "vitest";
import { resolveXTweetMedia } from "../../src/platform/x/xMediaResolver.js";

const postId = "123";

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

const fetchAs = (impl: ReturnType<typeof vi.fn>) => impl as unknown as typeof fetch;

describe("resolveXTweetMedia", () => {
  it("正文无 pic.twitter 短链时不发请求并返回空", async () => {
    const fetchImpl = vi.fn();
    const result = await resolveXTweetMedia({ postId, text: "just plain text" }, { fetchImpl: fetchAs(fetchImpl) });
    expect(result).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("从 mediaDetails 提取全部 photo（视频被过滤），带顺序", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({
      mediaDetails: [
        { type: "photo", media_url_https: "https://pbs.twimg.com/media/1.jpg" },
        { type: "video", video_info: { variants: [] } },
        { type: "photo", media_url_https: "https://pbs.twimg.com/media/2.jpg" },
      ],
    }));
    const result = await resolveXTweetMedia({ postId, text: "see pic.twitter.com/abc" }, { fetchImpl: fetchAs(fetchImpl) });
    expect(result).toEqual([
      { kind: "image", role: "context", sourceUrl: "https://pbs.twimg.com/media/1.jpg", order: 1 },
      { kind: "image", role: "context", sourceUrl: "https://pbs.twimg.com/media/2.jpg", order: 2 },
    ]);
  });

  it("含视频时追加一条 video 媒体项（携带选中 mp4 流）", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({
      mediaDetails: [
        { type: "photo", media_url_https: "https://pbs.twimg.com/media/1.jpg" },
        { type: "video", video_info: { variants: [
          { content_type: "application/x-mpegURL", url: "https://v/p.m3u8" },
          { bitrate: 1280000, content_type: "video/mp4", url: "https://v/640.mp4" },
          { bitrate: 432000, content_type: "video/mp4", url: "https://v/320.mp4" },
        ] } },
      ],
    }));
    const result = await resolveXTweetMedia({ postId, text: "see pic.twitter.com/abc" }, { fetchImpl: fetchAs(fetchImpl) });
    expect(result).toEqual([
      { kind: "image", role: "context", sourceUrl: "https://pbs.twimg.com/media/1.jpg", order: 1 },
      { kind: "video", role: "primary", sourceUrl: "https://v/320.mp4", mimeType: "video/mp4" },
    ]);
  });

  it("HTTP 非 2xx 时告警并返回空", async () => {
    const logger = { warn: vi.fn() };
    const fetchImpl = vi.fn().mockResolvedValue(new Response("", { status: 403 }));
    const result = await resolveXTweetMedia({ postId, text: "pic.twitter.com/abc", logger }, { fetchImpl: fetchAs(fetchImpl) });
    expect(result).toEqual([]);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("x_media_resolve_http:403"));
  });

  it("网络异常时告警并返回空", async () => {
    const logger = { warn: vi.fn() };
    const fetchImpl = vi.fn().mockRejectedValue(new Error("ECONNRESET"));
    const result = await resolveXTweetMedia({ postId, text: "pic.twitter.com/abc", logger }, { fetchImpl: fetchAs(fetchImpl) });
    expect(result).toEqual([]);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("x_media_resolve_network"));
  });

  it("无 mediaDetails 字段时返回空", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ text: "hello" }));
    const result = await resolveXTweetMedia({ postId, text: "pic.twitter.com/abc" }, { fetchImpl: fetchAs(fetchImpl) });
    expect(result).toEqual([]);
  });

  it("返回非 JSON 时返回空", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("not json", { status: 200 }));
    const result = await resolveXTweetMedia({ postId, text: "pic.twitter.com/abc" }, { fetchImpl: fetchAs(fetchImpl) });
    expect(result).toEqual([]);
  });
});
