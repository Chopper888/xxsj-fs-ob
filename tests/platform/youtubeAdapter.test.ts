import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { YouTubeAdapter } from "../../src/platform/youtube/youtubeAdapter.js";
import { buildYouTubeIdentity } from "../../src/platform/youtube/youtubeUrl.js";
import { prepareContent } from "../../src/platform/contentPreparation.js";
import type { YouTubeYtDlpConfig, YtDlpDeps } from "../../src/platform/youtube/youtubeYtDlp.js";

type ExecCallback = (error: Error | null, stdout: string, stderr: string) => void;

function meta(over: Record<string, unknown> = {}) {
  return {
    id: "dQw4w9WgXcQ", title: "Rick Astley Never Gonna Give You Up", uploader: "RickAstleyVEVO",
    uploader_url: "https://youtube.com/@rickastleyvevo", duration: 212, upload_date: "20240102", view_count: 1000,
    subtitles: { "zh-Hans": [{ ext: "vtt", url: "x" }], "en": [{ ext: "vtt", url: "y" }] },
    ...over,
  };
}

// 第一个调用（-J 元数据）返回 meta；--write-subs 调用按语言写入 vtt 文件。
function execFileSubtitle(m: Record<string, unknown>, vtt = "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\n你好世界\n"): YtDlpDeps["execFileImpl"] {
  return ((_c: string, args: string[], _o: object, cb: ExecCallback) => {
    if (args.includes("--dump-single-json")) return cb(null, JSON.stringify(m), "");
    if (args.includes("--write-subs")) {
      const lang = args[args.indexOf("--sub-langs") + 1];
      const out = args[args.indexOf("-o") + 1];
      const subDir = out.slice(0, -"%(id)s".length);
      mkdirSync(subDir, { recursive: true });
      writeFileSync(join(subDir, `${String(m.id)}.${lang}.vtt`), vtt, "utf8");
      return cb(null, "", "");
    }
    return cb(new Error("unexpected args"), "", "unexpected args");
  }) as unknown as YtDlpDeps["execFileImpl"];
}

const config: YouTubeYtDlpConfig = {
  ytDlpPath: "yt-dlp.exe", proxy: "http://127.0.0.1:7897",
  sleepRequests: 0, sleepInterval: 0, maxRetries: 1, retryBaseDelayMs: 5,
  languagePreferences: ["zh-Hans", "zh-Hant", "zh", "en"],
};

const cleanup: string[] = [];
afterEach(async () => {
  await Promise.all(cleanup.map((p) => import("node:fs/promises").then(({ rm }) => rm(p, { recursive: true, force: true }))));
  cleanup.length = 0;
});
function ctx() {
  const taskDir = join(tmpdir(), `yt-adapter-${randomUUID()}`);
  cleanup.push(taskDir);
  return { taskDir, signal: new AbortController().signal, logger: { info: () => undefined, warn: () => undefined } };
}

describe("YouTubeAdapter", () => {
  it("canHandle 识别 watch / youtu.be 链接", () => {
    const a = new YouTubeAdapter({ config, deps: {} });
    expect(a.canHandle({ sourceUrl: "https://youtu.be/dQw4w9WgXcQ" })).toBe(true);
    expect(a.canHandle({ sourceUrl: "https://www.bilibili.com/video/BV1Wy4y167Z9/" })).toBe(false);
  });

  it("resolveContent subtitle-first：官方字幕进入 primary，缩略图媒体条目保证 sourceCache 有效", async () => {
    const a = new YouTubeAdapter({ config, deps: { execFileImpl: execFileSubtitle(meta()) } });
    const c = await a.resolveContent(buildYouTubeIdentity("https://youtu.be/dQw4w9WgXcQ"), ctx());
    expect(c).toMatchObject({
      contentType: "video",
      title: "Rick Astley Never Gonna Give You Up",
      author: { name: "RickAstleyVEVO" },
      sourceMetadata: { subtitleAvailable: true, subtitleLanguage: "zh-Hans", acquisitionStrategy: "yt-dlp-subtitle-first" },
    });
    expect(c.texts[0]).toMatchObject({ kind: "official_subtitle", role: "primary", text: "你好世界", language: "zh-Hans" });
    expect(c.media.some((m) => m.kind === "video" && m.sourceUrl === "https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg")).toBe(true);
  });

  it("subtitle-first 走 prepareContent 不再转写", async () => {
    const a = new YouTubeAdapter({ config, deps: { execFileImpl: execFileSubtitle(meta()) } });
    const c = await a.resolveContent(buildYouTubeIdentity("https://youtu.be/dQw4w9WgXcQ"), ctx());
    const transcribe = { transcribe: () => { throw new Error("must not run"); }, materializeMedia: () => { throw new Error("must not run"); } };
    expect((await prepareContent(c, transcribe)).preparationMode).toBe("subtitle-first");
  });

  it("无官方字幕时走 media-first 策略标记", async () => {
    const a = new YouTubeAdapter({ config, deps: { execFileImpl: execFileSubtitle(meta({ subtitles: {} })) } });
    const c = await a.resolveContent(buildYouTubeIdentity("https://youtu.be/dQw4w9WgXcQ"), ctx());
    expect(c.sourceMetadata).toMatchObject({ subtitleAvailable: false, acquisitionStrategy: "yt-dlp-audio-asr" });
    expect(c.texts[0].kind).toBe("caption");
  });

  it("字幕下载非限流失败时回退 media-first，不中断", async () => {
    const m = meta();
    const impl = ((_c: string, args: string[], _o: object, cb: ExecCallback) => {
      if (args.includes("--dump-single-json")) return cb(null, JSON.stringify(m), "");
      return cb(new Error("This video is unavailable"), "", "ERROR: This video is unavailable");
    }) as unknown as YtDlpDeps["execFileImpl"];
    const a = new YouTubeAdapter({ config, deps: { execFileImpl: impl } });
    const c = await a.resolveContent(buildYouTubeIdentity("https://youtu.be/dQw4w9WgXcQ"), ctx());
    expect(c.sourceMetadata?.acquisitionStrategy).toBe("yt-dlp-audio-asr");
  });

  it("字幕下载遇限流 429 时上抛 rate_limited（交给 worker 延后重试）", async () => {
    const m = meta();
    const impl = ((_c: string, args: string[], _o: object, cb: ExecCallback) => {
      if (args.includes("--dump-single-json")) return cb(null, JSON.stringify(m), "");
      return cb(new Error("HTTP Error 429"), "", "ERROR: HTTP Error 429: Too Many Requests");
    }) as unknown as YtDlpDeps["execFileImpl"];
    const a = new YouTubeAdapter({ config, deps: { execFileImpl: impl } });
    await expect(a.resolveContent(buildYouTubeIdentity("https://youtu.be/dQw4w9WgXcQ"), ctx()))
      .rejects.toMatchObject({ code: "rate_limited" });
  });

  it("materializeMedia 下载音频到 taskDir/media/source.mp4", async () => {
    const impl = ((_c: string, args: string[], _o: object, cb: ExecCallback) => {
      const out = args[args.indexOf("-o") + 1];
      const mediaDir = out.slice(0, -"source.%(ext)s".length);
      mkdirSync(mediaDir, { recursive: true });
      writeFileSync(join(mediaDir, "source.m4a"), "A", "utf8");
      cb(null, "", "");
    }) as unknown as YtDlpDeps["execFileImpl"];
    const a = new YouTubeAdapter({ config, deps: { execFileImpl: impl } });
    const content = { identity: buildYouTubeIdentity("https://youtu.be/dQw4w9WgXcQ"), contentType: "video" as const, texts: [], media: [], links: [], sourceMetadata: {} };
    const [media] = await a.materializeMedia(content, ctx());
    expect(media.kind).toBe("audio");
    expect(media.localPath.toLowerCase()).toContain(join("media", "source.mp4").toLowerCase());
  });
});
