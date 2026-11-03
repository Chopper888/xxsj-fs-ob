import { execFile as nodeExecFile } from "node:child_process";
import { mkdir, readdir, readFile, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { PlatformAdapterError } from "../platformAdapter.js";
import type { MaterializedMedia } from "../types.js";

export interface YouTubeYtDlpConfig {
  ytDlpPath: string;
  proxy: string;
  sleepRequests: number;
  sleepInterval: number;
  maxRetries: number;
  retryBaseDelayMs: number;
  languagePreferences: string[];
  jsRuntimes?: string;
  remoteComponents?: string;
  // 仅 media-first 音频下载使用（S6-R3）：登录 cookie 与更保守的限速，subtitle-first 不接入。
  cookies?: string;
  mediaSleepRequests?: number;
  mediaSleepInterval?: number;
}

export interface YtDlpDeps {
  execFileImpl?: typeof nodeExecFile;
  logger?: { warn(message: string): void };
}

export function buildYouTubeYtDlpConfigFromEnv(
  env: Record<string, string | undefined> = process.env,
  cwd = process.cwd(),
): YouTubeYtDlpConfig {
  return {
    ytDlpPath: env.YTDLP_PATH?.trim() || join(cwd, ".venv", "Scripts", "yt-dlp.exe"),
    proxy: env.YTDLP_PROXY?.trim() || env.XXSJ_HTTPS_PROXY?.trim() || env.HTTPS_PROXY?.trim() || "",
    sleepRequests: Number(env.YTDLP_SLEEP_REQUESTS ?? 3),
    sleepInterval: Number(env.YTDLP_SLEEP_INTERVAL ?? 2),
    maxRetries: Number(env.YTDLP_MAX_RETRIES ?? 3),
    retryBaseDelayMs: Number(env.YTDLP_RETRY_BASE_MS ?? 20_000),
    languagePreferences: (env.YTDLP_LANGUAGE_PREFERENCE ?? "zh-Hans,zh-Hant,zh-CN,zh-TW,zh,en")
      .split(",").map((s) => s.trim()).filter(Boolean),
    jsRuntimes: env.YTDLP_JS_RUNTIMES?.trim() || undefined,
    remoteComponents: env.YTDLP_REMOTE_COMPONENTS?.trim() || undefined,
    cookies: env.YTDLP_COOKIES?.trim() || undefined,
    mediaSleepRequests: env.YTDLP_MEDIA_SLEEP_REQUESTS?.trim() ? Number(env.YTDLP_MEDIA_SLEEP_REQUESTS) : undefined,
    mediaSleepInterval: env.YTDLP_MEDIA_SLEEP_INTERVAL?.trim() ? Number(env.YTDLP_MEDIA_SLEEP_INTERVAL) : undefined,
  };
}

export interface YouTubeMetadata {
  videoId: string;
  title: string;
  uploader: string;
  uploaderUrl?: string;
  durationSeconds: number;
  uploadedAt?: string;
  viewCount?: number;
  officialSubtitleLangs: string[];
}

// R0 实测的限流信号：429（timedtext/API）、SSL EOF 封锁窗口、YouTube 机器人验证。
const RATE_LIMIT_RE = /(?:HTTP\s+Error\s+429|HTTP\s+429|Too\s+Many\s+Requests|SSL[:\s]*UNEXPECTED_EOF|SSLEOFError|EOF\s+occurred\s+in\s+violation\s+of\s+protocol|Sign\s+in\s+to\s+confirm\s+you['\u2019]?re\s+not\s+a\s+bot)/i;

function firstErrorLine(stderr: string): string {
  return stderr.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("WARNING")).at(-1) ?? "";
}

export function isRateLimitSignal(stderr: string): boolean {
  return RATE_LIMIT_RE.test(stderr);
}

function classifyYtDlpError(stderr: string, detail: string): Error {
  if (isRateLimitSignal(stderr)) return new PlatformAdapterError("rate_limited", `yt_dlp_rate_limited:${detail}`);
  if (/[Vv]ideo(?:\s+is)?\s+unavailable|This\s+video\s+has\s+been\s+removed|Video\s+not\s+available/i.test(stderr)) return new PlatformAdapterError("not_found", `yt_dlp_not_found:${detail}`);
  if (/[Pp]rivate\s+video|This\s+video\s+is\s+private/i.test(stderr)) return new PlatformAdapterError("private_content", `yt_dlp_private:${detail}`);
  if (/[Mm]embers[- ]only|Join\s+this\s+channel/i.test(stderr)) return new PlatformAdapterError("auth_required", `yt_dlp_members_only:${detail}`);
  return new PlatformAdapterError("content_unavailable", `yt_dlp_${detail || "unknown"}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function execFileAsync(execFileImpl: typeof nodeExecFile, command: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFileImpl(command, args, { maxBuffer: 64 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) reject({ error, stdout: String(stdout ?? ""), stderr: String(stderr ?? "") });
      else resolve({ stdout: String(stdout ?? ""), stderr: String(stderr ?? "") });
    });
  });
}

// 统一出口：带限速参数 + 429/SSL 信号退避重试；重试耗尽抛 rate_limited，交给 worker 延后到下一轮。
async function runYtDlp(
  config: YouTubeYtDlpConfig,
  args: string[],
  deps: YtDlpDeps = {},
): Promise<{ stdout: string; stderr: string }> {
  const execFileImpl = deps.execFileImpl ?? nodeExecFile;
  const attempts = config.maxRetries + 1;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await execFileAsync(execFileImpl, config.ytDlpPath, args);
    } catch (result) {
      const stderr = String((result as { stderr?: unknown })?.stderr ?? "");
      const detail = firstErrorLine(stderr) || String((result as { error?: Error })?.error?.message ?? "unknown");
      if (isRateLimitSignal(stderr) && attempt < attempts) {
        const delay = config.retryBaseDelayMs * attempt;
        deps.logger?.warn?.(`yt_dlp rate limited (${attempt}/${attempts}), retry in ${delay}ms: ${detail}`);
        await sleep(delay);
        continue;
      }
      throw classifyYtDlpError(stderr, detail);
    }
  }
  throw new PlatformAdapterError("rate_limited", "yt_dlp_exhausted");
}

function baseArgs(config: YouTubeYtDlpConfig, overrides?: { sleepRequests?: number; sleepInterval?: number }): string[] {
  const args = [
    "--no-playlist",
    ...(config.proxy ? ["--proxy", config.proxy] : []),
    "--sleep-requests", String(overrides?.sleepRequests ?? config.sleepRequests),
    "--sleep-interval", String(overrides?.sleepInterval ?? config.sleepInterval),
    "--no-progress",
  ];
  if (config.jsRuntimes) args.push("--js-runtimes", config.jsRuntimes);
  if (config.remoteComponents) args.push("--remote-components", config.remoteComponents);
  return args;
}

export async function fetchYouTubeMetadata(url: string, config: YouTubeYtDlpConfig, deps: YtDlpDeps = {}): Promise<YouTubeMetadata> {
  const { stdout } = await runYtDlp(config, [...baseArgs(config), "--skip-download", "--dump-single-json", url], deps);
  let info: Record<string, unknown>;
  try {
    info = JSON.parse(stdout) as Record<string, unknown>;
  } catch {
    throw new PlatformAdapterError("content_invalid", "yt_dlp_metadata_parse_failed");
  }
  const subtitles = (info.subtitles ?? {}) as Record<string, unknown>;
  return {
    videoId: String(info.id ?? ""),
    title: String(info.title ?? ""),
    uploader: String(info.uploader ?? info.channel ?? ""),
    uploaderUrl: typeof info.uploader_url === "string" ? info.uploader_url : undefined,
    durationSeconds: Number(info.duration ?? 0),
    uploadedAt: toIsoUploadDate(info.upload_date),
    viewCount: Number(info.view_count) || undefined,
    officialSubtitleLangs: Object.keys(subtitles).filter((k) => Array.isArray(subtitles[k]) && (subtitles[k] as unknown[]).length > 0),
  };
}

function toIsoUploadDate(uploadDate: unknown): string | undefined {
  const s = String(uploadDate ?? "");
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(s);
  if (!m) return undefined;
  const date = new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

// 字幕语言优先：中文变体 → en → 第一个可用。仅匹配官方字幕（subtitles），不含自动字幕（automatic_captions）。
export function pickSubtitleLanguage(available: string[], preferences: string[]): string | null {
  if (!available.length) return null;
  const lower = available.map((l) => l.toLowerCase());
  for (const pref of preferences) {
    const p = pref.toLowerCase();
    const exact = lower.findIndex((l) => l === p);
    if (exact >= 0) return available[exact];
    const prefix = lower.findIndex((l) => l.startsWith(`${p}-`));
    if (prefix >= 0) return available[prefix];
  }
  return available[0];
}

export async function downloadYouTubeSubtitle(
  url: string,
  language: string,
  taskDir: string,
  config: YouTubeYtDlpConfig,
  deps: YtDlpDeps = {},
): Promise<{ path: string; text: string; language: string }> {
  const subDir = join(taskDir, "media", "subs");
  await mkdir(subDir, { recursive: true });
  const output = join(subDir, "%(id)s");
  await runYtDlp(config, [...baseArgs(config), "--skip-download", "--write-subs", "--sub-langs", language, "-o", output, url], deps);
  try {
    const files = await readdir(subDir);
    const subFile = files.find((f) => f.includes(`.${language}.`) && (f.endsWith(".vtt") || f.endsWith(".srt") || f.endsWith(".ttml")));
    if (!subFile) throw new PlatformAdapterError("content_unavailable", "yt_dlp_subtitle_file_missing");
    const path = join(subDir, subFile);
    const text = parseSubtitleText(await readFile(path, "utf8"));
    if (!text.trim()) throw new PlatformAdapterError("content_unavailable", "yt_dlp_subtitle_empty");
    return { path, text, language };
  } finally {
    // 字幕文本已进入内容缓存，任务目录不残留字幕文件。
    await rm(subDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

export function parseSubtitleText(raw: string): string {
  const lines = raw.replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  let inHeader = true;
  for (const line of lines) {
    const t = line.trim();
    if (inHeader) {
      if (t === "") inHeader = false;
      continue;
    }
    if (!t) { out.push(""); continue; }
    if (/^\d{1,2}:\d{2}:\d{2}[.,]\d{3}\s*-->\s*\d{1,2}:\d{2}:\d{2}[.,]\d{3}/.test(t)) continue;
    if (/^\d+$/.test(t)) continue;
    if (/^(WEBVTT|NOTE|Kind:|Language:|Style:)/i.test(t)) continue;
    out.push(t.replace(/<[^>]+>/g, "").trim());
  }
  return out.filter((l) => l !== "").join("\n");
}

const AUDIO_FILE_RE = /^source\.(mp4|m4a|webm|opus|ogg|mka)$/i;

// audio-only 最低码率下载（-f 139 为 m4a 49kbps，m4a 属 MP4 容器家族，命名为 source.mp4 复用 storageCleanup 约定）。
export async function downloadYouTubeAudio(
  url: string,
  taskDir: string,
  config: YouTubeYtDlpConfig,
  deps: YtDlpDeps = {},
): Promise<MaterializedMedia> {
  const mediaDir = join(taskDir, "media");
  await mkdir(mediaDir, { recursive: true });
  const existing = (await readdir(mediaDir).catch(() => [] as string[])).find((f) => AUDIO_FILE_RE.test(f));
  if (existing) {
    const p = join(mediaDir, existing);
    return { kind: "audio", localPath: p, mediaUrl: url, bytes: (await stat(p)).size };
  }
  // media-first 专用：登录 cookie + 更保守限速（S6-R3），subtitle-first 不接入 cookie。
  const sleepOverride =
    config.mediaSleepRequests != null || config.mediaSleepInterval != null
      ? { sleepRequests: config.mediaSleepRequests, sleepInterval: config.mediaSleepInterval }
      : undefined;
  const args = [...baseArgs(config, sleepOverride)];
  if (config.cookies) args.push("--cookies", config.cookies);
  args.push("--format", "139/wa", "-o", join(mediaDir, "source.%(ext)s"), url);
  await runYtDlp(config, args, deps);
  const files = await readdir(mediaDir);
  const audioFile = files.find((f) => AUDIO_FILE_RE.test(f));
  if (!audioFile) throw new PlatformAdapterError("media_unavailable", "yt_dlp_audio_missing");
  const path = join(mediaDir, audioFile);
  if (audioFile.toLowerCase() === "source.m4a") {
    const mp4 = join(mediaDir, "source.mp4");
    await rename(path, mp4);
    return { kind: "audio", localPath: mp4, mediaUrl: url, bytes: (await stat(mp4)).size };
  }
  return { kind: "audio", localPath: path, mediaUrl: url, bytes: (await stat(path)).size };
}
