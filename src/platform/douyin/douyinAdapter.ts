import { join } from "node:path";
import { captureDouyinMediaWithBrowser, type CaptureDouyinMediaOptions, type CaptureDouyinMediaResult } from "../../media/douyinMediaCapture.js";
import { PlatformAdapterError, type NormalizedUrl, type PlatformAdapter, type PlatformInput, type PlatformRuntimeContext } from "../platformAdapter.js";
import type { MaterializedMedia, NormalizedContent, PlatformIdentity } from "../types.js";
import { extractDouyinAwemeId, isDouyinArticleUrl, isDouyinNoteUrl, resolveDouyinNoteContent } from "./douyinNoteContent.js";

export type CaptureMedia = (options: CaptureDouyinMediaOptions, log?: (message: string) => void) => Promise<CaptureDouyinMediaResult>;

function buildDouyinCanonicalUrl(inputUrl: string, id: string): string {
  if (isDouyinNoteUrl(inputUrl)) return `https://www.douyin.com/note/${id}`;
  if (isDouyinArticleUrl(inputUrl)) return `https://www.douyin.com/article/${id}`;
  return `https://www.douyin.com/jingxuan?modal_id=${id}`;
}

function deriveDouyinNoteTitle(desc: string): string {
  const firstLine = desc.split(/\r?\n/)[0]?.trim() ?? "";
  if (firstLine) return firstLine.slice(0, 80);
  return desc.slice(0, 80) || "抖音图文";
}
export interface DouyinAdapterOptions { captureMedia?: CaptureMedia; userDataDir?: string; headless?: boolean; timeoutMs?: number }

export class DouyinAdapter implements PlatformAdapter {
  readonly platform = "douyin" as const;
  private readonly captureMedia: CaptureMedia;
  constructor(private readonly options: DouyinAdapterOptions = {}) { this.captureMedia = options.captureMedia ?? captureDouyinMediaWithBrowser; }

  canHandle(input: PlatformInput): boolean {
    try { const url = new URL(input.sourceUrl); return /(^|\.)douyin\.com$/i.test(url.hostname) && extractDouyinAwemeId(input.sourceUrl) !== undefined; } catch { return false; }
  }
  async normalizeUrl(input: PlatformInput, context: PlatformRuntimeContext): Promise<NormalizedUrl> {
    context.signal.throwIfAborted();
    if (!this.canHandle(input)) throw new PlatformAdapterError("invalid_url", "not_a_douyin_url");
    const id = extractDouyinAwemeId(input.sourceUrl)!;
    return { sourceUrl: input.sourceUrl, canonicalUrl: buildDouyinCanonicalUrl(input.sourceUrl, id), platformContentId: id, dedupeKey: input.dedupeKey };
  }
  async resolveIdentity(normalized: NormalizedUrl, context: PlatformRuntimeContext): Promise<PlatformIdentity> {
    context.signal.throwIfAborted();
    const id = normalized.platformContentId ?? extractDouyinAwemeId(normalized.canonicalUrl);
    if (!id || id === "unknown") throw new PlatformAdapterError("invalid_url", "douyin_work_id_missing");
    return { platform: this.platform, platformContentId: id, sourceUrl: normalized.sourceUrl, canonicalUrl: normalized.canonicalUrl, dedupeKey: normalized.dedupeKey?.trim() || `douyin:${id}` };
  }
  async resolveContent(identity: PlatformIdentity, context: PlatformRuntimeContext): Promise<NormalizedContent> {
    context.signal.throwIfAborted();
    if (isDouyinNoteUrl(identity.sourceUrl) || isDouyinArticleUrl(identity.sourceUrl)) {
      return this.resolveNoteContent(identity, context);
    }
    return { identity, contentType: "video", texts: [], media: [{ kind: "video", role: "primary", sourceUrl: identity.canonicalUrl }], links: [{ url: identity.canonicalUrl, role: "source" }] };
  }
  private async resolveNoteContent(identity: PlatformIdentity, context: PlatformRuntimeContext): Promise<NormalizedContent> {
    const note = await resolveDouyinNoteContent({
      inputUrl: identity.sourceUrl,
      userDataDir: this.options.userDataDir ?? join(process.cwd(), ".browser", "douyin"),
      headless: this.options.headless ?? false,
      timeoutMs: this.options.timeoutMs ?? 30000,
    });
    const title = deriveDouyinNoteTitle(note.desc);
    return {
      identity,
      contentType: note.contentType,
      title,
      author: { name: note.author },
      publishedAt: note.publishedAt,
      texts: [{ kind: "body", role: "primary", text: note.desc }],
      media: note.images.map((image, index) => ({ kind: "image" as const, role: "context" as const, sourceUrl: image.sourceUrl, order: index + 1 })),
      links: [{ url: identity.canonicalUrl, role: "source" }],
      sourceMetadata: { awemeId: note.awemeId, imageCount: note.images.length, noteKind: note.kind },
    };
  }
  async materializeMedia(content: NormalizedContent, context: PlatformRuntimeContext): Promise<MaterializedMedia[]> {
    context.signal.throwIfAborted();
    const outputPath = join(context.taskDir, "media", "source.mp4");
    const result = await this.captureMedia({ inputUrl: content.identity.sourceUrl, outputPath, userDataDir: this.options.userDataDir ?? join(process.cwd(), ".browser", "douyin"), headless: this.options.headless ?? false, timeoutMs: this.options.timeoutMs ?? 30000 }, (message) => context.logger.info(message));
    return [{ kind: "video", localPath: outputPath, mediaUrl: result.resolvedUrl, bytes: result.bytes }];
  }
}
