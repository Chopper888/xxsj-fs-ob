import { describe, expect, it, vi } from "vitest";
import {
  buildDouyinVideoDownloadUrl,
  captureDouyinMediaFromPage,
  cleanEscapedMediaUrl,
  douyinMediaDownloadReferer,
  extractDouyinVideoResourceId,
  ffprobeJsonHasAudio,
  isDouyinMediaUrl,
  isPreferredDouyinMediaUrl,
  normalizeDouyinVideoUrl,
  orderDouyinMediaCandidates,
  resolveDouyinMediaDownloadUrl,
  resolveDouyinMediaFromPage,
  selectDouyinVideoResourceId,
} from "../../src/media/douyinMediaCapture.js";

describe("douyin media capture helpers", () => {
  it("resolves a direct download URL from detail metadata without downloading media", async () => {
    const page = {
      url: () => "https://www.douyin.com/jingxuan",
      evaluate: vi.fn().mockResolvedValue({
        aweme_detail: { aweme_id: "7650000000000000000", video: { play_addr: { uri: "resource-id" } } },
      }),
    } as never;
    await expect(resolveDouyinMediaFromPage(page, "https://www.douyin.com/video/7650000000000000000"))
      .resolves.toMatchObject({
        id: "7650000000000000000",
        directUrl: "https://aweme.snssdk.com/aweme/v1/play/?video_id=resource-id&ratio=1080p&line=0",
      });
  });
  it("normalizes Douyin links to the Jingxuan modal entrypoint", () => {
    expect(normalizeDouyinVideoUrl("https://www.douyin.com/jingxuan?modal_id=7650000000000000000")).toEqual({
      id: "7650000000000000000",
      url: "https://www.douyin.com/jingxuan?modal_id=7650000000000000000",
    });
    expect(normalizeDouyinVideoUrl("https://www.douyin.com/video/7650000000000000000")).toEqual({
      id: "7650000000000000000",
      url: "https://www.douyin.com/jingxuan?modal_id=7650000000000000000",
    });
  });

  it("recognizes preferred media URLs", () => {
    expect(isDouyinMediaUrl("https://www.douyin.com/aweme/v1/play/?video_id=abc")).toBe(true);
    expect(isPreferredDouyinMediaUrl("https://v3-dy-o-abtest.zjcdn.com/video/tos/example")).toBe(true);
    expect(isPreferredDouyinMediaUrl("https://example.com/page")).toBe(false);
  });

  it("cleans escaped douyinvod URLs found in page HTML", () => {
    expect(cleanEscapedMediaUrl("https:\\/\\/www.douyinvod.com\\/video\\/tos\\u002Fabc\\u0026x=1")).toBe(
      "https://www.douyinvod.com/video/tos/abc&x=1",
    );
  });

  it("detects whether ffprobe output contains an audio stream", () => {
    expect(ffprobeJsonHasAudio(JSON.stringify({ streams: [{ codec_type: "video" }] }))).toBe(false);
    expect(ffprobeJsonHasAudio(JSON.stringify({ streams: [{ codec_type: "video" }, { codec_type: "audio" }] }))).toBe(true);
    expect(ffprobeJsonHasAudio("not-json")).toBe(false);
  });

  it("tries aweme play URLs before raw CDN video candidates", () => {
    const ordered = orderDouyinMediaCandidates([
      "https://v3-dy-o-abtest.zjcdn.com/video/tos/mock-video-only.mp4",
      "https://www.douyin.com/aweme/v1/play/?video_id=mock",
      "https://example.com/not-media",
    ]);

    expect(ordered[0]).toContain("/aweme/v1/play");
    expect(ordered[1]).toContain("/video/tos/");
  });

  it("extracts video_id from a captured aweme play request", () => {
    expect(
      extractDouyinVideoResourceId(
        "https://www.douyin.com/aweme/v1/play/?video_id=v0200fg10000abc%2Fdef&ratio=720p",
      ),
    ).toBe("v0200fg10000abc/def");
  });

  it("selects video_id only from the matching aweme detail", () => {
    const payload = {
      unrelated: {
        aweme_id: "7650000000000000001",
        video: { play_addr: { uri: "wrong-resource-id" } },
      },
      aweme_detail: {
        aweme_id: "7650000000000000000",
        video: { play_addr: { uri: "matching-resource-id" } },
      },
    };

    expect(selectDouyinVideoResourceId(payload, "7650000000000000000")).toBe("matching-resource-id");
    expect(selectDouyinVideoResourceId(payload, "7650000000000000002")).toBeUndefined();
  });

  it("does not fall back to unrelated page media when exact detail lookup fails", async () => {
    const goto = vi.fn().mockResolvedValue(undefined);
    const page = {
      url: () => "https://www.douyin.com/jingxuan",
      evaluate: vi.fn().mockResolvedValue(undefined),
      goto,
    } as never;

    await expect(
      captureDouyinMediaFromPage(
        page,
        "https://www.douyin.com/jingxuan?modal_id=7650000000000000000",
        "/tmp/target.mp4",
      ),
    ).rejects.toThrow("media_candidate_missing");
    expect(goto).not.toHaveBeenCalled();
  });

  it("builds the skill non-watermark download endpoint from video_id", () => {
    expect(buildDouyinVideoDownloadUrl("v0200fg10000abc/def")).toBe(
      "https://aweme.snssdk.com/aweme/v1/play/?video_id=v0200fg10000abc%2Fdef&ratio=1080p&line=0",
    );
  });

  it("rewrites only captured aweme play requests and leaves CDN candidates unchanged", () => {
    expect(
      resolveDouyinMediaDownloadUrl(
        "https://www.douyin.com/aweme/v1/play/?video_id=v0200fg10000abc&ratio=720p",
      ),
    ).toBe("https://aweme.snssdk.com/aweme/v1/play/?video_id=v0200fg10000abc&ratio=1080p&line=0");
    expect(resolveDouyinMediaDownloadUrl("https://www.douyinvod.com/video/tos/signed.mp4?token=test")).toBe(
      "https://www.douyinvod.com/video/tos/signed.mp4?token=test",
    );
  });

  it("uses the H5 referer only for the rewritten non-watermark endpoint", () => {
    expect(douyinMediaDownloadReferer("https://aweme.snssdk.com/aweme/v1/play/?video_id=abc")).toBe(
      "https://www.iesdouyin.com/",
    );
    expect(douyinMediaDownloadReferer("https://www.douyinvod.com/video/tos/example.mp4")).toBe(
      "https://www.douyin.com/",
    );
  });
});
