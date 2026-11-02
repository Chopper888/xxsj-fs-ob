import { mkdirSync, writeFileSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildYouTubeYtDlpConfigFromEnv, downloadYouTubeAudio, downloadYouTubeSubtitle,
  fetchYouTubeMetadata, isRateLimitSignal, parseSubtitleText, pickSubtitleLanguage,
} from "../../src/platform/youtube/youtubeYtDlp.js";
import type { YtDlpDeps } from "../../src/platform/youtube/youtubeYtDlp.js";

type ExecCallback = (error: Error | null, stdout: string, stderr: string) => void;
type ExecImpl = (cmd: string, args: string[], opts: object, cb: ExecCallback) => void;

function execFileMock(handler: (args: string[], cb: ExecCallback) => void): YtDlpDeps["execFileImpl"] {
  return ((_cmd: string, args: string[], _opts: object, cb: ExecCallback) => handler(args, cb)) as unknown as YtDlpDeps["execFileImpl"];
}
const ok = (stdout: string) => (_a: string[], cb: ExecCallback) => cb(null, stdout, "");
const fail = (stderr: string) => (_a: string[], cb: ExecCallback) => cb(new Error(stderr), "", stderr);

function cfg(over: Partial<ReturnType<typeof buildYouTubeYtDlpConfigFromEnv>> = {}) {
  return {
    ytDlpPath: "yt-dlp.exe", proxy: "http://127.0.0.1:7897",
    sleepRequests: 0, sleepInterval: 0, maxRetries: 2, retryBaseDelayMs: 5,
    languagePreferences: ["zh-Hans", "zh-Hant", "zh", "en"],
    ...over,
  };
}

const cleanup: string[] = [];
afterEach(async () => {
  await Promise.all(cleanup.map((p) => rm(p, { recursive: true, force: true })));
  cleanup.length = 0;
});
const taskDir = () => { const d = join(tmpdir(), `yt-${randomUUID()}`); cleanup.push(d); return d; };

describe("buildYouTubeYtDlpConfigFromEnv", () => {
  it("读取 YTDLP_* 覆盖，缺省落到 venv 路径 + 本地代理", () => {
    const c = buildYouTubeYtDlpConfigFromEnv({ YTDLP_PATH: "custom.exe", YTDLP_SLEEP_REQUESTS: "5", YTDLP_SLEEP_INTERVAL: "1" }, "ROOT");
    expect(c.ytDlpPath).toBe("custom.exe");
    expect(c.sleepRequests).toBe(5);
    expect(c.sleepInterval).toBe(1);
    expect(c.maxRetries).toBe(3);
    const d = buildYouTubeYtDlpConfigFromEnv({}, "ROOT");
    expect(d.ytDlpPath).toBe(join("ROOT", ".venv", "Scripts", "yt-dlp.exe"));
    expect(d.proxy).toContain("127.0.0.1");
  });
  it("代理优先级 YTDLP_PROXY > HTTPS_PROXY", () => {
    expect(buildYouTubeYtDlpConfigFromEnv({ YTDLP_PROXY: "socks5://a", HTTPS_PROXY: "http://b" }).proxy).toBe("socks5://a");
    expect(buildYouTubeYtDlpConfigFromEnv({ HTTPS_PROXY: "http://b" }).proxy).toBe("http://b");
  });
  it("YTDLP_JS_RUNTIMES 读取 JS runtime，未设置时为 undefined", () => {
    expect(buildYouTubeYtDlpConfigFromEnv({ YTDLP_JS_RUNTIMES: "deno" }).jsRuntimes).toBe("deno");
    expect(buildYouTubeYtDlpConfigFromEnv({ YTDLP_JS_RUNTIMES: "  " }).jsRuntimes).toBeUndefined();
    expect(buildYouTubeYtDlpConfigFromEnv({}).jsRuntimes).toBeUndefined();
  });
  it("YTDLP_REMOTE_COMPONENTS 读取远程组件，未设置时为 undefined", () => {
    expect(buildYouTubeYtDlpConfigFromEnv({ YTDLP_REMOTE_COMPONENTS: "ejs:github" }).remoteComponents).toBe("ejs:github");
    expect(buildYouTubeYtDlpConfigFromEnv({}).remoteComponents).toBeUndefined();
  });
  it("YTDLP_COOKIES / YTDLP_MEDIA_SLEEP_* 读取 media-first 专用配置，未设置时为 undefined", () => {
    const c = buildYouTubeYtDlpConfigFromEnv({
      YTDLP_COOKIES: "cookies/yt.txt", YTDLP_MEDIA_SLEEP_REQUESTS: "1", YTDLP_MEDIA_SLEEP_INTERVAL: "5",
    });
    expect(c.cookies).toBe("cookies/yt.txt");
    expect(c.mediaSleepRequests).toBe(1);
    expect(c.mediaSleepInterval).toBe(5);
    const d = buildYouTubeYtDlpConfigFromEnv({});
    expect(d.cookies).toBeUndefined();
    expect(d.mediaSleepRequests).toBeUndefined();
    expect(d.mediaSleepInterval).toBeUndefined();
  });
});

describe("isRateLimitSignal", () => {
  it("识别 429、SSL EOF、机器人验证信号", () => {
    expect(isRateLimitSignal("ERROR: HTTP Error 429: Too Many Requests")).toBe(true);
    expect(isRateLimitSignal("ERROR: HTTP 429")).toBe(true);
    expect(isRateLimitSignal("SSLEOFError(8, 'EOF occurred in violation of protocol')")).toBe(true);
    expect(isRateLimitSignal("SSL: UNEXPECTED_EOF_WHILE_READING")).toBe(true);
    expect(isRateLimitSignal("Sign in to confirm you're not a bot")).toBe(true);
    expect(isRateLimitSignal("video unavailable")).toBe(false);
  });
});

describe("fetchYouTubeMetadata", () => {
  const meta = {
    id: "dQw4w9WgXcQ", title: "Rick Astley", uploader: "Someone", uploader_url: "https://youtube.com/@someone",
    duration: 212, upload_date: "20240102", view_count: 1000,
    subtitles: { "zh-Hans": [{ ext: "vtt", url: "x" }], "en": [{ ext: "vtt", url: "y" }] },
    automatic_captions: { "zh-Hans": [{ ext: "vtt", url: "z" }] },
  };
  it("解析元数据，officialSubtitleLangs 只来自 subtitles（不含自动字幕）", async () => {
    const m = await fetchYouTubeMetadata("https://youtu.be/x", cfg(), { execFileImpl: execFileMock(ok(JSON.stringify(meta))) });
    expect(m).toMatchObject({ videoId: "dQw4w9WgXcQ", title: "Rick Astley", durationSeconds: 212, viewCount: 1000 });
    expect(m.uploadedAt).toBe("2024-01-02T00:00:00.000Z");
    expect(m.officialSubtitleLangs).toEqual(["zh-Hans", "en"]);
  });
  it("调用带 proxy + sleep + no-playlist 保护参数", async () => {
    const spy = vi.fn();
    const impl = ((_c: string, args: string[], _o: object, cb: ExecCallback) => { spy(args); cb(null, JSON.stringify(meta), ""); }) as unknown as YtDlpDeps["execFileImpl"];
    await fetchYouTubeMetadata("https://youtu.be/x", cfg(), { execFileImpl: impl });
    const args = spy.mock.calls[0][0];
    expect(args).toContain("--no-playlist");
    expect(args).toContain("--proxy");
    expect(args).toContain("--sleep-requests");
    expect(args).toContain("--no-progress");
  });
  it("配置 jsRuntimes 时透传 --js-runtimes 参数", async () => {
    const spy = vi.fn();
    const impl = ((_c: string, args: string[], _o: object, cb: ExecCallback) => { spy(args); cb(null, JSON.stringify(meta), ""); }) as unknown as YtDlpDeps["execFileImpl"];
    await fetchYouTubeMetadata("https://youtu.be/x", cfg({ jsRuntimes: "deno" }), { execFileImpl: impl });
    const args = spy.mock.calls[0][0];
    expect(args).toContain("--js-runtimes");
    expect(args).toContain("deno");
  });
  it("配置 remoteComponents 时透传 --remote-components 参数", async () => {
    const spy = vi.fn();
    const impl = ((_c: string, args: string[], _o: object, cb: ExecCallback) => { spy(args); cb(null, JSON.stringify(meta), ""); }) as unknown as YtDlpDeps["execFileImpl"];
    await fetchYouTubeMetadata("https://youtu.be/x", cfg({ remoteComponents: "ejs:github" }), { execFileImpl: impl });
    const args = spy.mock.calls[0][0];
    expect(args).toContain("--remote-components");
    expect(args).toContain("ejs:github");
  });
  it("metadata 调用不透传 --cookies（subtitle-first 保持无 cookie）", async () => {
    const spy = vi.fn();
    const impl = ((_c: string, args: string[], _o: object, cb: ExecCallback) => { spy(args); cb(null, JSON.stringify(meta), ""); }) as unknown as YtDlpDeps["execFileImpl"];
    await fetchYouTubeMetadata("https://youtu.be/x", cfg({ cookies: "cookies/yt.txt" }), { execFileImpl: impl });
    expect(spy.mock.calls[0][0]).not.toContain("--cookies");
  });
  it("JSON 解析失败报 content_invalid", async () => {
    await expect(fetchYouTubeMetadata("u", cfg(), { execFileImpl: execFileMock(ok("not json")) })).rejects.toMatchObject({ code: "content_invalid" });
  });
});

describe("pickSubtitleLanguage", () => {
  it("按偏好精确命中 zh-Hans", () => {
    expect(pickSubtitleLanguage(["en", "zh-Hans", "de"], ["zh-Hans", "en"])).toBe("zh-Hans");
  });
  it("偏好前缀 zh- 匹配 zh-TW", () => {
    expect(pickSubtitleLanguage(["en", "zh-TW"], ["zh-Hans", "zh-TW"])).toBe("zh-TW");
  });
  it("无中文时回退 en，再回退第一个可用", () => {
    expect(pickSubtitleLanguage(["en", "de"], ["zh-Hans", "en"])).toBe("en");
    expect(pickSubtitleLanguage(["de", "fr"], ["zh-Hans", "en"])).toBe("de");
  });
  it("空列表返回 null", () => {
    expect(pickSubtitleLanguage([], ["en"])).toBeNull();
  });
});

describe("parseSubtitleText", () => {
  it("剥离 WEBVTT 头、时间轴、序号与标签", () => {
    const raw = [
      "WEBVTT", "", "Kind: captions", "Language: zh-Hans", "",
      "1", "00:00:01.000 --> 00:00:03.000", "Hello <c>world</c>", "",
      "2", "00:00:04.000 --> 00:00:06.000", "Second line",
    ].join("\n");
    expect(parseSubtitleText(raw)).toBe("Hello world\nSecond line");
  });
});

describe("downloadYouTubeSubtitle", () => {
  const VTT = "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHello world\n\n00:00:02.500 --> 00:00:04.000\nSecond line\n";
  it("下载解析字幕文本，完成后清理 subs 目录", async () => {
    const dir = taskDir();
    const impl = execFileMock((args, cb) => {
      const out = args[args.indexOf("-o") + 1];
      const subDir = out.slice(0, -"%(id)s".length);
      mkdirSync(subDir, { recursive: true });
      writeFileSync(join(subDir, "dQw4w9WgXcQ.zh-Hans.vtt"), VTT, "utf8");
      cb(null, "", "");
    });
    const r = await downloadYouTubeSubtitle("https://youtu.be/x", "zh-Hans", dir, cfg(), { execFileImpl: impl });
    expect(r.language).toBe("zh-Hans");
    expect(r.text).toBe("Hello world\nSecond line");
    await expect(import("node:fs/promises").then(({ access }) => access(join(dir, "media", "subs")))).rejects.toThrow();
  });
  it("字幕文件缺失报 content_unavailable", async () => {
    await expect(downloadYouTubeSubtitle("https://youtu.be/x", "zh-Hans", taskDir(), cfg(), { execFileImpl: execFileMock(ok("")) }))
      .rejects.toMatchObject({ code: "content_unavailable" });
  });
  it("字幕内容为空报 content_unavailable", async () => {
    const impl = execFileMock((args, cb) => {
      const out = args[args.indexOf("-o") + 1];
      const subDir = out.slice(0, -"%(id)s".length);
      mkdirSync(subDir, { recursive: true });
      writeFileSync(join(subDir, "x.zh-Hans.vtt"), "WEBVTT\n\n", "utf8");
      cb(null, "", "");
    });
    await expect(downloadYouTubeSubtitle("https://youtu.be/x", "zh-Hans", taskDir(), cfg(), { execFileImpl: impl }))
      .rejects.toMatchObject({ code: "content_unavailable" });
  });
});

describe("downloadYouTubeAudio", () => {
  it("下载后把 source.m4a 重命名为 source.mp4", async () => {
    const dir = taskDir();
    const impl = execFileMock((args, cb) => {
      const out = args[args.indexOf("-o") + 1];
      const mediaDir = out.slice(0, -"source.%(ext)s".length);
      mkdirSync(mediaDir, { recursive: true });
      writeFileSync(join(mediaDir, "source.m4a"), "AUDIO", "utf8");
      cb(null, "", "");
    });
    const m = await downloadYouTubeAudio("https://youtu.be/x", dir, cfg(), { execFileImpl: impl });
    expect(m.localPath.toLowerCase()).toContain(join("media", "source.mp4").toLowerCase());
  });
  it("已存在音频文件时复用，不重复下载", async () => {
    const dir = taskDir();
    const impl = execFileMock((_a, cb) => cb(null, "", ""));
    await mkdir(join(dir, "media"), { recursive: true });
    await writeFile(join(dir, "media", "source.mp4"), "EXIST", "utf8");
    const m = await downloadYouTubeAudio("https://youtu.be/x", dir, cfg(), { execFileImpl: impl });
    expect(m.localPath.toLowerCase()).toContain(join("media", "source.mp4").toLowerCase());
  });
  it("配置 cookies 时透传 --cookies，且用 media-first 保守限速", async () => {
    const dir = taskDir();
    const spy = vi.fn();
    const impl = ((_c: string, args: string[], _o: object, cb: ExecCallback) => {
      spy(args);
      const out = args[args.indexOf("-o") + 1];
      const mediaDir = out.slice(0, -"source.%(ext)s".length);
      mkdirSync(mediaDir, { recursive: true });
      writeFileSync(join(mediaDir, "source.m4a"), "AUDIO", "utf8");
      cb(null, "", "");
    }) as unknown as YtDlpDeps["execFileImpl"];
    await downloadYouTubeAudio("https://youtu.be/x", dir, cfg({ cookies: "cookies/yt.txt", mediaSleepRequests: 1, mediaSleepInterval: 5 }), { execFileImpl: impl });
    const args = spy.mock.calls[0][0];
    expect(args).toContain("--cookies");
    expect(args).toContain("cookies/yt.txt");
    expect(args[args.indexOf("--sleep-requests") + 1]).toBe("1");
    expect(args[args.indexOf("--sleep-interval") + 1]).toBe("5");
  });
});

describe("限速重试（runYtDlp 内部）", () => {
  it("429 后线性退避重试成功", async () => {
    let call = 0;
    const impl = ((_c: string, _a: string[], _o: object, cb: ExecCallback) => {
      call += 1;
      if (call === 1) cb(new Error("HTTP Error 429: Too Many Requests"), "", "ERROR: HTTP Error 429");
      else cb(null, JSON.stringify({ id: "x", subtitles: {} }), "");
    }) as unknown as YtDlpDeps["execFileImpl"];
    const logger = { warn: vi.fn() };
    const m = await fetchYouTubeMetadata("u", cfg({ maxRetries: 1, retryBaseDelayMs: 5 }), { execFileImpl: impl, logger });
    expect(m.videoId).toBe("x");
    expect(call).toBe(2);
    expect(logger.warn).toHaveBeenCalled();
  });
  it("重试耗尽后抛 rate_limited", async () => {
    const impl = execFileMock(fail("ERROR: HTTP Error 429: Too Many Requests"));
    await expect(fetchYouTubeMetadata("u", cfg({ maxRetries: 2, retryBaseDelayMs: 5 }), { execFileImpl: impl }))
      .rejects.toMatchObject({ code: "rate_limited" });
  });
  it("非限流错误不重试，直接分类", async () => {
    const impl = execFileMock(fail("This video is unavailable"));
    await expect(fetchYouTubeMetadata("u", cfg(), { execFileImpl: impl })).rejects.toMatchObject({ code: "not_found" });
  });
  it("私有视频分类为 private_content", async () => {
    const impl = execFileMock(fail("This video is private"));
    await expect(fetchYouTubeMetadata("u", cfg(), { execFileImpl: impl })).rejects.toMatchObject({ code: "private_content" });
  });
});
