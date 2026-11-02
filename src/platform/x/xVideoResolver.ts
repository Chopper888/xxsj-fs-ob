import { access, mkdir, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { PlatformAdapterError } from "../platformAdapter.js";
import type { MaterializedMedia } from "../types.js";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const DEFAULT_BASE_URL = "https://cdn.syndication.twimg.com/tweet-result";

export interface XVideoStream { url: string; mimeType: "video/mp4" | "application/x-mpegURL" }
export interface XVideoResolverInput { postId: string; logger?: { warn(message: string): void } }
export interface XVideoResolverOptions { fetchImpl?: typeof fetch; baseUrl?: string; tokenBuilder?: (postId: string) => string }
export interface XVideoMaterializeInput { taskDir: string; stream: XVideoStream; referer: string; logger?: { warn(message: string): void } }
export interface XVideoMaterializeOptions { fetchImpl?: typeof fetch; minBytes?: number; maxBytes?: number; ffmpegPath?: string; ffmpegRunner?: (args: string[]) => Promise<void> }

// token 值当前不校验，但未来可能收紧。抽成独立函数，将来复刻 token 算法时只改这里。
export function buildSyndicationToken(postId: string): string {
  return postId;
}

interface StreamVariant { url: string; bitrate?: number }

// 纯函数：从 syndication JSON 选视频流。优先 mp4 直链 + 最低码率，无 mp4 才回落 m3u8。
export function selectVideoStream(json: unknown): XVideoStream | null {
  const root = (json ?? {}) as { video?: { variants?: unknown[] }; mediaDetails?: Array<{ video_info?: { variants?: unknown[] } }> };
  const mp4: StreamVariant[] = [];
  const m3u8: StreamVariant[] = [];
  const add = (v: unknown) => {
    const item = (v ?? {}) as { type?: string; content_type?: string; bitrate?: number; url?: string; src?: string };
    const type = item.type ?? item.content_type ?? "";
    const url = item.url ?? item.src;
    if (!url) return;
    if (type === "video/mp4") mp4.push({ url, bitrate: Number(item.bitrate) || undefined });
    else if (type === "application/x-mpegURL") m3u8.push({ url });
  };
  for (const m of root.mediaDetails ?? []) {
    const variants = m?.video_info?.variants;
    if (Array.isArray(variants)) for (const v of variants) add(v);
  }
  for (const v of root.video?.variants ?? []) add(v);
  const rated = mp4.filter(v => v.bitrate != null);
  const pool = rated.length ? rated : mp4;
  if (pool.length) {
    pool.sort((a, b) => (a.bitrate ?? 0) - (b.bitrate ?? 0));
    return { url: pool[0].url, mimeType: "video/mp4" };
  }
  if (m3u8.length) return { url: m3u8[0].url, mimeType: "application/x-mpegURL" };
  return null;
}

export async function resolveXTweetVideoStream(input: XVideoResolverInput, options: XVideoResolverOptions = {}): Promise<XVideoStream | null> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
  const token = options.tokenBuilder ? options.tokenBuilder(input.postId) : buildSyndicationToken(input.postId);
  let response: Response;
  try {
    response = await fetchImpl(`${baseUrl}?id=${encodeURIComponent(input.postId)}&lang=en&token=${encodeURIComponent(token)}`, {
      headers: { "User-Agent": UA },
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    input.logger?.warn?.(`x_video_resolve_network:${String(error)}`);
    return null;
  }
  if (!response.ok) {
    input.logger?.warn?.(`x_video_resolve_http:${response.status}`);
    return null;
  }
  let json: unknown;
  try {
    json = await response.json();
  } catch {
    return null;
  }
  return selectVideoStream(json);
}

const looksLikeMp4 = (b: Uint8Array): boolean => b.length >= 8 && b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70;

export async function materializeXVideoMedia(input: XVideoMaterializeInput, options: XVideoMaterializeOptions = {}): Promise<MaterializedMedia> {
  return input.stream.mimeType === "application/x-mpegURL"
    ? downloadHls(input, options)
    : downloadMp4(input, options);
}

async function downloadMp4(input: XVideoMaterializeInput, options: XVideoMaterializeOptions): Promise<MaterializedMedia> {
  const dir = join(input.taskDir, "media");
  const dest = join(dir, "source.mp4");
  const f = options.fetchImpl ?? fetch;
  let r: Response;
  try {
    r = await f(input.stream.url, { headers: { "User-Agent": UA, Referer: input.referer }, signal: AbortSignal.timeout(60_000) });
  } catch (error) {
    throw new PlatformAdapterError("temporary_network", String(error));
  }
  const type = r.headers.get("content-type") ?? "";
  const declared = Number(r.headers.get("content-length") ?? 0);
  const max = options.maxBytes ?? 1024 * 1024 * 1024;
  if (!r.ok || !/^video\//i.test(type) || declared > max) throw new PlatformAdapterError("media_unavailable", `HTTP ${r.status} ${type}`);
  const bytes = new Uint8Array(await r.arrayBuffer());
  const min = options.minBytes ?? 1024;
  if (bytes.length < min || bytes.length > max || !looksLikeMp4(bytes)) throw new PlatformAdapterError("media_unavailable", "media_size_invalid");
  await mkdir(dir, { recursive: true });
  const tmp = `${dest}.tmp`;
  await writeFile(tmp, bytes);
  await rename(tmp, dest).catch(async (e) => { await unlink(tmp).catch(() => {}); throw e; });
  await access(dest);
  return { kind: "video", localPath: dest, mediaUrl: input.stream.url, bytes: bytes.length };
}

async function fetchBytes(f: typeof fetch, url: string, referer: string): Promise<Uint8Array> {
  let r: Response;
  try {
    r = await f(url, { headers: { "User-Agent": UA, Referer: referer }, signal: AbortSignal.timeout(60_000) });
  } catch (error) {
    throw new PlatformAdapterError("temporary_network", String(error));
  }
  if (!r.ok) throw new PlatformAdapterError("media_unavailable", `hls_http_${r.status}`);
  return new Uint8Array(await r.arrayBuffer());
}

const resolveRef = (base: string, ref: string): string => new URL(ref, base).toString();

// 若给到的是主列表（EXT-X-STREAM-INF），选带宽最低的变体；否则原样返回（已是媒体列表）。
function pickMediaPlaylist(master: string, baseUrl: string): string {
  let best: { uri: string; bandwidth: number } | null = null;
  let pending: { bandwidth: number } | null = null;
  for (const raw of master.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith("#EXT-X-STREAM-INF")) {
      const bw = Number(/\bBANDWIDTH=(\d+)/i.exec(line)?.[1] ?? 0);
      pending = { bandwidth: bw };
    } else if (line && !line.startsWith("#")) {
      if (pending && (!best || pending.bandwidth < best.bandwidth)) best = { uri: line, bandwidth: pending.bandwidth };
      pending = null;
    }
  }
  return best ? resolveRef(baseUrl, best.uri) : baseUrl;
}

interface HlsSegment { url: string; duration: number }

function parseSegments(media: string, baseUrl: string): HlsSegment[] {
  const segs: HlsSegment[] = [];
  let duration = 10;
  for (const raw of media.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith("#EXTINF")) {
      const d = Number(/:([\d.]+)/.exec(line)?.[1]);
      if (Number.isFinite(d)) duration = d;
    } else if (line.startsWith("#EXT-X-KEY")) {
      throw new PlatformAdapterError("media_unavailable", "hls_encrypted_unsupported");
    } else if (line && !line.startsWith("#")) {
      segs.push({ url: resolveRef(baseUrl, line), duration });
    }
  }
  return segs;
}

async function downloadHls(input: XVideoMaterializeInput, options: XVideoMaterializeOptions): Promise<MaterializedMedia> {
  const dir = join(input.taskDir, "media");
  const dest = join(dir, "source.mp4");
  const hlsDir = join(dir, ".hls");
  await mkdir(dir, { recursive: true });
  await mkdir(hlsDir, { recursive: true });
  const f = options.fetchImpl ?? fetch;
  try {
    const master = new TextDecoder().decode(await fetchBytes(f, input.stream.url, input.referer));
    const mediaUrl = pickMediaPlaylist(master, input.stream.url);
    const mediaText = new TextDecoder().decode(await fetchBytes(f, mediaUrl, input.referer));
    const segments = parseSegments(mediaText, mediaUrl);
    if (!segments.length) throw new PlatformAdapterError("media_unavailable", "hls_no_segments");
    const localPaths: string[] = [];
    for (let i = 0; i < segments.length; i++) {
      const bytes = await fetchBytes(f, segments[i].url, input.referer);
      if (!bytes.length) throw new PlatformAdapterError("media_unavailable", "hls_empty_segment");
      const file = join(hlsDir, `seg-${String(i).padStart(4, "0")}.ts`);
      await writeFile(file, bytes);
      localPaths.push(file);
    }
    const playlist = ["#EXTM3U", "#EXT-X-VERSION:3", "#EXT-X-MEDIA-SEQUENCE:0", "#EXT-X-TARGETDURATION:10", ...localPaths.flatMap((p, i) => [`#EXTINF:${segments[i].duration},`, p]), "#EXT-X-ENDLIST"].join("\n");
    const playlistPath = join(hlsDir, "index.m3u8");
    await writeFile(playlistPath, playlist);
    const runner = options.ffmpegRunner ?? ((args: string[]) => runFfmpeg(args, options));
    await runner(["-y", "-i", playlistPath, "-c", "copy", dest]);
    const merged = await stat(dest);
    return { kind: "video", localPath: dest, mediaUrl: input.stream.url, bytes: merged.size };
  } finally {
    await rm(hlsDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

function runFfmpeg(args: string[], options: XVideoMaterializeOptions): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(options.ffmpegPath ?? "ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr?.on("data", (chunk: string) => { stderr += chunk; });
    child.on("error", (err) => reject(new PlatformAdapterError("media_unavailable", `ffmpeg_spawn: ${String(err)}`)));
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new PlatformAdapterError("media_unavailable", `ffmpeg_exit_${String(code)}: ${stderr.slice(-500)}`));
    });
  });
}
