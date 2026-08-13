import { join } from "node:path";
import { captureDouyinMediaWithBrowser, normalizeDouyinVideoUrl, type CaptureDouyinMediaOptions, type CaptureDouyinMediaResult } from "../../media/douyinMediaCapture.js";
import { PlatformAdapterError, type NormalizedUrl, type PlatformAdapter, type PlatformInput, type PlatformRuntimeContext } from "../platformAdapter.js";
import type { MaterializedMedia, NormalizedContent, PlatformIdentity } from "../types.js";

export type CaptureMedia = (options: CaptureDouyinMediaOptions, log?: (message: string) => void) => Promise<CaptureDouyinMediaResult>;
export interface DouyinAdapterOptions { captureMedia?: CaptureMedia; userDataDir?: string; headless?: boolean; timeoutMs?: number }

export class DouyinAdapter implements PlatformAdapter {
  readonly platform = "douyin" as const;
  private readonly captureMedia: CaptureMedia;
  constructor(private readonly options: DouyinAdapterOptions = {}) { this.captureMedia = options.captureMedia ?? captureDouyinMediaWithBrowser; }

  canHandle(input: PlatformInput): boolean {
    try { const url = new URL(input.sourceUrl); return /(^|\.)douyin\.com$/i.test(url.hostname) && (/\/video\/\d{8,}/.test(url.pathname) || /^\d{8,}$/.test(url.searchParams.get("modal_id") ?? "")); } catch { return false; }
  }
  async normalizeUrl(input: PlatformInput, context: PlatformRuntimeContext): Promise<NormalizedUrl> {
    context.signal.throwIfAborted();
    if (!this.canHandle(input)) throw new PlatformAdapterError("invalid_url", "not_a_douyin_video_url");
    const normalized = normalizeDouyinVideoUrl(input.sourceUrl);
    return { sourceUrl: input.sourceUrl, canonicalUrl: normalized.url, platformContentId: normalized.id, dedupeKey: input.dedupeKey };
  }
  async resolveIdentity(normalized: NormalizedUrl, context: PlatformRuntimeContext): Promise<PlatformIdentity> {
    context.signal.throwIfAborted();
    const id = normalized.platformContentId ?? normalizeDouyinVideoUrl(normalized.canonicalUrl).id;
    if (!id || id === "unknown") throw new PlatformAdapterError("invalid_url", "douyin_work_id_missing");
    return { platform: this.platform, platformContentId: id, sourceUrl: normalized.sourceUrl, canonicalUrl: normalized.canonicalUrl, dedupeKey: normalized.dedupeKey?.trim() || `douyin:${id}` };
  }
  async resolveContent(identity: PlatformIdentity, context: PlatformRuntimeContext): Promise<NormalizedContent> {
    context.signal.throwIfAborted();
    return { identity, contentType: "video", texts: [], media: [{ kind: "video", role: "primary", sourceUrl: identity.canonicalUrl }], links: [{ url: identity.canonicalUrl, role: "source" }] };
  }
  async materializeMedia(content: NormalizedContent, context: PlatformRuntimeContext): Promise<MaterializedMedia[]> {
    context.signal.throwIfAborted();
    const outputPath = join(context.taskDir, "media", "source.mp4");
    const result = await this.captureMedia({ inputUrl: content.identity.sourceUrl, outputPath, userDataDir: this.options.userDataDir ?? join(process.cwd(), ".browser", "douyin"), headless: this.options.headless ?? false, timeoutMs: this.options.timeoutMs ?? 30000 }, (message) => context.logger.info(message));
    return [{ kind: "video", localPath: outputPath, mediaUrl: result.resolvedUrl, bytes: result.bytes }];
  }
}
