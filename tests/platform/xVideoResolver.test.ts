import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { selectVideoStream, resolveXTweetVideoStream, materializeXVideoMedia, buildSyndicationToken } from "../../src/platform/x/xVideoResolver.js";

const mp4Bytes = new Uint8Array([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0x00, 0x00, 0x02, 0x00, 0x00, 0x00, 0x00, 0x00]);
const mp4Response = () => new Response(mp4Bytes, { status: 200, headers: { "content-type": "video/mp4" } });

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "xv-test-"));
}

describe("selectVideoStream 格式选择", () => {
  it("优先 mp4 且选最低码率（来自 mediaDetails.video_info.variants）", () => {
    const json = {
      video: { variants: [{ type: "video/mp4", src: "https://v/320.mp4" }] },
      mediaDetails: [{ type: "video", video_info: { variants: [
        { content_type: "application/x-mpegURL", url: "https://v/p.m3u8" },
        { bitrate: 1280000, content_type: "video/mp4", url: "https://v/640.mp4" },
        { bitrate: 432000, content_type: "video/mp4", url: "https://v/320.mp4" },
        { bitrate: 832000, content_type: "video/mp4", url: "https://v/540.mp4" },
      ] } }],
    };
    expect(selectVideoStream(json)).toEqual({ url: "https://v/320.mp4", mimeType: "video/mp4" });
  });
  it("无 mediaDetails 时回落到 video.variants 的 mp4（无码率取第一个）", () => {
    const json = { video: { variants: [
      { type: "application/x-mpegURL", src: "https://v/p.m3u8" },
      { type: "video/mp4", src: "https://v/high.mp4" },
      { type: "video/mp4", src: "https://v/low.mp4" },
    ] } };
    expect(selectVideoStream(json)).toEqual({ url: "https://v/high.mp4", mimeType: "video/mp4" });
  });
  it("无 mp4 时回落 m3u8", () => {
    const json = { video: { variants: [{ type: "application/x-mpegURL", src: "https://v/p.m3u8" }] } };
    expect(selectVideoStream(json)).toEqual({ url: "https://v/p.m3u8", mimeType: "application/x-mpegURL" });
  });
  it("无任何视频流时返回 null", () => {
    expect(selectVideoStream({ text: "hello" })).toBeNull();
    expect(selectVideoStream(null)).toBeNull();
  });
});

describe("resolveXTweetVideoStream", () => {
  it("走 tokenBuilder 拼接 URL，返回选中的流", async () => {
    const tokenBuilder = vi.fn((postId: string) => `tok-${postId}`);
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      video: { variants: [{ type: "video/mp4", src: "https://v/a.mp4" }] },
    }), { status: 200, headers: { "content-type": "application/json" } }));
    const result = await resolveXTweetVideoStream({ postId: "123" }, { fetchImpl: fetchImpl as unknown as typeof fetch, tokenBuilder });
    expect(tokenBuilder).toHaveBeenCalledWith("123");
    expect(String(fetchImpl.mock.calls[0][0])).toContain("token=tok-123");
    expect(result).toEqual({ url: "https://v/a.mp4", mimeType: "video/mp4" });
  });
  it("默认 token 为 postId，网络异常时告警并返回 null", async () => {
    const logger = { warn: vi.fn() };
    const fetchImpl = vi.fn().mockRejectedValue(new Error("ECONNRESET"));
    const result = await resolveXTweetVideoStream({ postId: "123", logger }, { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(result).toBeNull();
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("x_video_resolve_network"));
    expect(buildSyndicationToken("123")).toBe("123");
  });
  it("HTTP 非 2xx 时返回 null", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("", { status: 403 }));
    const result = await resolveXTweetVideoStream({ postId: "123" }, { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(result).toBeNull();
  });
});

describe("materializeXVideoMedia", () => {
  it("mp4 直链下载到 media/source.mp4 并校验 ftyp", async () => {
    const dir = tempDir();
    try {
      const fetchImpl = vi.fn().mockResolvedValue(mp4Response());
      const media = await materializeXVideoMedia({ taskDir: dir, stream: { url: "https://v/a.mp4", mimeType: "video/mp4" }, referer: "https://x.com/a/status/1" }, { fetchImpl: fetchImpl as unknown as typeof fetch, minBytes: 1 });
      expect(media.localPath).toBe(join(dir, "media", "source.mp4"));
      expect(media.bytes).toBe(mp4Bytes.length);
      expect(statSync(media.localPath).size).toBe(mp4Bytes.length);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it("mp4 非视频 content-type 时抛 media_unavailable", async () => {
    const dir = tempDir();
    try {
      const fetchImpl = vi.fn().mockResolvedValue(new Response(mp4Bytes, { status: 200, headers: { "content-type": "text/html" } }));
      await expect(materializeXVideoMedia({ taskDir: dir, stream: { url: "https://v/a.mp4", mimeType: "video/mp4" }, referer: "https://x.com" }, { fetchImpl: fetchImpl as unknown as typeof fetch })).rejects.toMatchObject({ code: "media_unavailable" });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it("m3u8：主列表选最低带宽变体→下载分段→ffmpeg 合并→临时目录清理", async () => {
    const dir = tempDir();
    try {
      const master = "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=2000000,RESOLUTION=720x1280\nhigh/playlist.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=600000\nlow/playlist.m3u8\n";
      const media = "#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:6\n#EXT-X-MEDIA-SEQUENCE:0\n#EXTINF:6.0,\nseg0.ts\n#EXTINF:6.0,\nseg1.ts\n#EXT-X-ENDLIST\n";
      const fetchImpl = vi.fn(async (url: string) => {
        const u = new URL(url);
        if (u.pathname.endsWith(".m3u8") && u.pathname.endsWith("playlist.m3u8")) return new Response(media, { status: 200 });
        if (u.pathname.endsWith(".m3u8")) return new Response(master, { status: 200 });
        return new Response(new Uint8Array([0x47, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]), { status: 200 });
      });
      const ffmpegRunner = vi.fn(async (args: string[]) => { const dest = args[args.length - 1]; writeFileSync(dest, mp4Bytes); });
      const mediaResult = await materializeXVideoMedia({ taskDir: dir, stream: { url: "https://v/p.m3u8", mimeType: "application/x-mpegURL" }, referer: "https://x.com" }, { fetchImpl: fetchImpl as unknown as typeof fetch, ffmpegRunner });
      expect(ffmpegRunner).toHaveBeenCalledTimes(1);
      expect(String(fetchImpl.mock.calls.map(c => c[0]).join(" "))).toContain("low/playlist.m3u8");
      expect(mediaResult.localPath).toBe(join(dir, "media", "source.mp4"));
      expect(statSync(mediaResult.localPath).size).toBe(mp4Bytes.length);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it("m3u8 含加密 KEY 时抛 hls_encrypted_unsupported", async () => {
    const dir = tempDir();
    try {
      const master = "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=600000\nlow/playlist.m3u8\n";
      const media = "#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI=\"https://k\"\n#EXTINF:6.0,\nseg0.ts\n#EXT-X-ENDLIST\n";
      const fetchImpl = vi.fn(async (url: string) => new Response(url.includes("low/playlist") ? media : master, { status: 200 }));
      await expect(materializeXVideoMedia({ taskDir: dir, stream: { url: "https://v/p.m3u8", mimeType: "application/x-mpegURL" }, referer: "https://x.com" }, { fetchImpl: fetchImpl as unknown as typeof fetch })).rejects.toMatchObject({ code: "media_unavailable" });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
