import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { dirname } from "node:path";
import { chromium, type BrowserContext, type Page } from "playwright";

export const DOUYIN_MOBILE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 TikTok/26.2.0 TTWebView/TikTokWebView";

const MEDIA_MARKERS = ["douyinvod.com", "/video/tos/", "/aweme/v1/play", "aweme.snssdk.com/aweme/v1/play"];
const PREFERRED_MARKERS = ["douyinvod.com", "/video/tos/"];
const PLAY_URL_MARKERS = ["/aweme/v1/play", "aweme.snssdk.com/aweme/v1/play"];
const DOUYIN_VIDEO_DOWNLOAD_ENDPOINT = "https://aweme.snssdk.com/aweme/v1/play/";
const DOUYIN_JINGXUAN_URL = "https://www.douyin.com/jingxuan";

export interface NormalizedDouyinUrl {
  id: string;
  url: string;
}

export interface CaptureDouyinMediaOptions {
  inputUrl: string;
  outputPath: string;
  userDataDir: string;
  headless?: boolean;
  timeoutMs?: number;
}

export interface CaptureDouyinMediaResult {
  id: string;
  outputPath: string;
  bytes: number;
  candidateCount: number;
  resolvedUrl: string;
}

export interface ResolvedDouyinMedia {
  id: string;
  directUrl: string;
  resolvedAt: string;
}

async function minimizePageWindow(page: Page): Promise<void> {
  const session = await page.context().newCDPSession(page);
  try {
    const { windowId } = await session.send("Browser.getWindowForTarget");
    await session.send("Browser.setWindowBounds", {
      windowId,
      bounds: { windowState: "minimized" },
    });
  } finally {
    await session.detach().catch(() => undefined);
  }
}

async function hideMacChromiumApp(): Promise<void> {
  if (process.platform !== "darwin") return;

  await new Promise<void>((resolve) => {
    execFile(
      "osascript",
      ["-e", 'tell application "System Events" to set visible of process "Google Chrome for Testing" to false'],
      () => resolve(),
    );
  });
}

async function hideMediaPageIfRequested(page: Page, enabled: boolean): Promise<void> {
  if (!enabled) return;
  await minimizePageWindow(page).catch(() => undefined);
  await hideMacChromiumApp().catch(() => undefined);
}

export function normalizeDouyinVideoUrl(input: string): NormalizedDouyinUrl {
  const modal = input.match(/[?&]modal_id=(\d{8,})/);
  const video = input.match(/\/video\/(\d{8,})/);
  const id = modal?.[1] ?? video?.[1] ?? "unknown";
  return {
    id,
    url: id === "unknown" ? input : `https://www.douyin.com/jingxuan?modal_id=${id}`,
  };
}

export function isDouyinMediaUrl(url: string): boolean {
  return MEDIA_MARKERS.some((marker) => url.includes(marker));
}

export function isPreferredDouyinMediaUrl(url: string): boolean {
  return PREFERRED_MARKERS.some((marker) => url.includes(marker));
}

export function orderDouyinMediaCandidates(candidates: string[]): string[] {
  return [...candidates].sort((left, right) => mediaCandidatePriority(left) - mediaCandidatePriority(right));
}

export function cleanEscapedMediaUrl(value: string): string {
  return value.replace(/\\u002F/g, "/").replace(/\\\//g, "/").replace(/\\u0026/g, "&");
}

export function extractDouyinVideoResourceId(url: string): string | undefined {
  if (!PLAY_URL_MARKERS.some((marker) => url.includes(marker))) return undefined;
  try {
    return new URL(url).searchParams.get("video_id") ?? undefined;
  } catch {
    return undefined;
  }
}

function findMatchingAwemeDetail(payload: unknown, awemeId: string): Record<string, unknown> | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  if (Array.isArray(payload)) {
    for (const item of payload) {
      const found = findMatchingAwemeDetail(item, awemeId);
      if (found) return found;
    }
    return undefined;
  }

  const object = payload as Record<string, unknown>;
  const directId = object.aweme_id ?? object.awemeId ?? object.id;
  if (String(directId ?? "") === awemeId && object.video && typeof object.video === "object") {
    return object;
  }

  for (const value of Object.values(object)) {
    const found = findMatchingAwemeDetail(value, awemeId);
    if (found) return found;
  }
  return undefined;
}

export function selectDouyinVideoResourceId(payload: unknown, awemeId: string): string | undefined {
  const detail = findMatchingAwemeDetail(payload, awemeId);
  const video = detail?.video && typeof detail.video === "object" ? (detail.video as Record<string, unknown>) : undefined;
  if (!video) return undefined;

  const addresses = [video.play_addr, video.play_addr_h264, video.play_addr_265];
  const bitRates = Array.isArray(video.bit_rate) ? video.bit_rate : [];
  for (const bitRate of bitRates) {
    if (bitRate && typeof bitRate === "object") {
      addresses.push((bitRate as Record<string, unknown>).play_addr);
    }
  }

  for (const address of addresses) {
    if (!address || typeof address !== "object") continue;
    const uri = (address as Record<string, unknown>).uri;
    if (typeof uri === "string" && uri.trim()) return uri.trim();
  }
  return undefined;
}

export function buildDouyinVideoDownloadUrl(videoResourceId: string, ratio = "1080p"): string {
  const query = new URLSearchParams({ video_id: videoResourceId, ratio, line: "0" });
  return `${DOUYIN_VIDEO_DOWNLOAD_ENDPOINT}?${query.toString()}`;
}

export function resolveDouyinMediaDownloadUrl(candidateUrl: string): string {
  const videoResourceId = extractDouyinVideoResourceId(candidateUrl);
  return videoResourceId ? buildDouyinVideoDownloadUrl(videoResourceId) : candidateUrl;
}

export function douyinMediaDownloadReferer(downloadUrl: string): string {
  return downloadUrl.startsWith(DOUYIN_VIDEO_DOWNLOAD_ENDPOINT)
    ? "https://www.iesdouyin.com/"
    : "https://www.douyin.com/";
}

export function ffprobeJsonHasAudio(stdout: string): boolean {
  try {
    const payload = JSON.parse(stdout) as { streams?: Array<{ codec_type?: string }> };
    return Array.isArray(payload.streams) && payload.streams.some((stream) => stream.codec_type === "audio");
  } catch {
    return false;
  }
}

function mediaCandidatePriority(url: string): number {
  if (PLAY_URL_MARKERS.some((marker) => url.includes(marker))) return 0;
  if (isPreferredDouyinMediaUrl(url)) return 1;
  return 2;
}

function rememberCandidate(candidates: string[], url: string): "preferred" | "fallback" | undefined {
  if (!isDouyinMediaUrl(url) || candidates.includes(url)) return undefined;
  candidates.push(url);
  return isPreferredDouyinMediaUrl(url) ? "preferred" : "fallback";
}

async function fetchDouyinVideoResourceIdFromDetailApi(page: Page, awemeId: string, timeoutMs: number): Promise<string | undefined> {
  if (!page.url().startsWith("https://www.douyin.com/")) {
    await page.goto(DOUYIN_JINGXUAN_URL, { waitUntil: "domcontentloaded", timeout: timeoutMs }).catch(() => undefined);
  }

  const payload = await page
    .evaluate(async (id) => {
      const endpoint = new URL("/aweme/v1/web/aweme/detail/", window.location.origin);
      endpoint.searchParams.set("aweme_id", id);
      endpoint.searchParams.set("aid", "6383");
      endpoint.searchParams.set("device_platform", "webapp");

      const response = await fetch(endpoint.toString(), {
        credentials: "include",
        headers: { accept: "application/json" },
      });
      if (!response.ok) return undefined;
      return response.json();
    }, awemeId)
    .catch(() => undefined);

  return selectDouyinVideoResourceId(payload, awemeId);
}

export async function resolveDouyinMediaFromPage(
  page: Page,
  inputUrl: string,
  timeoutMs = 25000,
): Promise<ResolvedDouyinMedia> {
  const target = normalizeDouyinVideoUrl(inputUrl);
  if (target.id === "unknown") throw new Error("media_target_id_missing");
  const resourceId = await fetchDouyinVideoResourceIdFromDetailApi(page, target.id, timeoutMs);
  if (!resourceId) throw new Error("media_candidate_missing");
  return { id: target.id, directUrl: buildDouyinVideoDownloadUrl(resourceId), resolvedAt: new Date().toISOString() };
}

async function downloadBinary(url: string, outputPath: string): Promise<number> {
  const response = await fetch(url, {
    headers: {
      "User-Agent": DOUYIN_MOBILE_UA,
      Referer: douyinMediaDownloadReferer(url),
    },
  });
  if (!response.ok) throw new Error(`media_download_failed:${response.status}`);

  const bytes = new Uint8Array(await response.arrayBuffer());
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, bytes);
  return bytes.length;
}

function mediaFileHasAudioStream(filePath: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    execFile("ffprobe", ["-v", "error", "-show_streams", "-of", "json", filePath], (error, stdout) => {
      if (error) {
        reject(new Error("media_audio_probe_failed"));
        return;
      }
      resolve(ffprobeJsonHasAudio(String(stdout || "{}")));
    });
  });
}

export async function captureDouyinMediaFromPage(
  page: Page,
  inputUrl: string,
  outputPath: string,
  timeoutMs = 25000,
  onCandidate?: (kind: "preferred" | "fallback") => void,
  hideBrowser = false,
): Promise<CaptureDouyinMediaResult> {
  const target = normalizeDouyinVideoUrl(inputUrl);
  const candidates: string[] = [];

  const remember = (url: string) => {
    const kind = rememberCandidate(candidates, url);
    if (kind) onCandidate?.(kind);
  };

  await hideMediaPageIfRequested(page, hideBrowser);
  if (target.id === "unknown") throw new Error("media_target_id_missing");

  const resolved = await resolveDouyinMediaFromPage(page, inputUrl, timeoutMs);
  remember(resolved.directUrl);

  const orderedCandidates = orderDouyinMediaCandidates(candidates);
  if (!orderedCandidates.length) throw new Error("media_candidate_missing");

  let lastError: Error | undefined;
  let sawMediaWithoutAudio = false;
  for (const [index, mediaUrl] of orderedCandidates.entries()) {
    const tempPath = `${outputPath}.candidate-${index}.mp4`;
    try {
      const bytes = await downloadBinary(resolveDouyinMediaDownloadUrl(mediaUrl), tempPath);
      if (!(await mediaFileHasAudioStream(tempPath))) {
        sawMediaWithoutAudio = true;
        await unlink(tempPath).catch(() => undefined);
        continue;
      }
      await mkdir(dirname(outputPath), { recursive: true });
      await rename(tempPath, outputPath);
      return {
        id: target.id,
        outputPath,
        bytes,
        candidateCount: candidates.length,
        resolvedUrl: resolved.directUrl,
      };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error("media_capture_failed");
      await unlink(tempPath).catch(() => undefined);
    }
  }

  if (sawMediaWithoutAudio) throw new Error("media_audio_stream_missing");
  throw lastError ?? new Error("media_candidate_missing");
}

export async function resolveDouyinMediaWithBrowser(
  options: Omit<CaptureDouyinMediaOptions, "outputPath">,
): Promise<ResolvedDouyinMedia> {
  let context: BrowserContext | undefined;
  try {
    context = await chromium.launchPersistentContext(options.userDataDir, {
      headless: options.headless ?? false,
      args: ["--disable-session-crashed-bubble", "--window-position=-32000,-32000", "--window-size=430,860", "--start-minimized"],
      viewport: { width: 390, height: 844 },
      userAgent: DOUYIN_MOBILE_UA,
      locale: "zh-CN",
    });
    const page = context.pages()[0] ?? (await context.newPage());
    await hideMediaPageIfRequested(page, true);
    return await resolveDouyinMediaFromPage(page, options.inputUrl, options.timeoutMs);
  } finally {
    await context?.close().catch(() => undefined);
  }
}

export async function captureDouyinMediaWithBrowser(
  options: CaptureDouyinMediaOptions,
  onCandidate?: (kind: "preferred" | "fallback") => void,
): Promise<CaptureDouyinMediaResult> {
  let context: BrowserContext | undefined;
  try {
    context = await chromium.launchPersistentContext(options.userDataDir, {
      headless: options.headless ?? false,
      args: ["--disable-session-crashed-bubble", "--window-position=-32000,-32000", "--window-size=430,860", "--start-minimized"],
      viewport: { width: 390, height: 844 },
      userAgent: DOUYIN_MOBILE_UA,
      locale: "zh-CN",
    });
    const page = context.pages()[0] ?? (await context.newPage());
    return await captureDouyinMediaFromPage(page, options.inputUrl, options.outputPath, options.timeoutMs, onCandidate, true);
  } finally {
    await context?.close().catch(() => undefined);
  }
}
