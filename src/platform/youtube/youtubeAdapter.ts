import type { PlatformAdapter, PlatformInput, PlatformRuntimeContext, NormalizedUrl } from "../platformAdapter.js";
import { PlatformAdapterError } from "../platformAdapter.js";
import type { MaterializedMedia, NormalizedContent, PlatformIdentity } from "../types.js";
import { buildYouTubeIdentity, isYouTubeUrl } from "./youtubeUrl.js";
import {
  buildYouTubeYtDlpConfigFromEnv, downloadYouTubeAudio, downloadYouTubeSubtitle, fetchYouTubeMetadata,
  pickSubtitleLanguage, type YouTubeYtDlpConfig, type YtDlpDeps,
} from "./youtubeYtDlp.js";

function thumbnailUrl(videoId: string): string {
  return `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
}

export interface YouTubeAdapterOptions {
  config?: YouTubeYtDlpConfig;
  deps?: YtDlpDeps;
}

export class YouTubeAdapter implements PlatformAdapter {
  readonly platform = "youtube" as const;
  private readonly config: YouTubeYtDlpConfig;
  private readonly deps: YtDlpDeps;

  constructor(options: YouTubeAdapterOptions = {}) {
    this.config = options.config ?? buildYouTubeYtDlpConfigFromEnv();
    this.deps = options.deps ?? {};
  }

  canHandle(i: PlatformInput): boolean {
    return isYouTubeUrl(i.sourceUrl);
  }

  async normalizeUrl(i: PlatformInput, _c: PlatformRuntimeContext): Promise<NormalizedUrl> {
    const x = buildYouTubeIdentity(i.sourceUrl);
    return { sourceUrl: i.sourceUrl, canonicalUrl: x.canonicalUrl, platformContentId: x.platformContentId, dedupeKey: i.dedupeKey };
  }

  async resolveIdentity(n: NormalizedUrl, _c: PlatformRuntimeContext): Promise<PlatformIdentity> {
    const x = buildYouTubeIdentity(n.canonicalUrl);
    return n.dedupeKey
      ? { ...x, sourceUrl: n.sourceUrl, dedupeKey: n.dedupeKey, dedupeAliases: [x.dedupeKey] }
      : { ...x, sourceUrl: n.sourceUrl };
  }

  async resolveContent(identity: PlatformIdentity, ctx: PlatformRuntimeContext): Promise<NormalizedContent> {
    const metadata = await fetchYouTubeMetadata(identity.canonicalUrl, this.config, this.deps);
    const author = metadata.uploader ? { name: metadata.uploader, url: metadata.uploaderUrl } : undefined;
    const lang = pickSubtitleLanguage(metadata.officialSubtitleLangs, this.config.languagePreferences);
    if (lang) {
      try {
        const sub = await downloadYouTubeSubtitle(identity.canonicalUrl, lang, ctx.taskDir, this.config, this.deps);
        return {
          identity,
          contentType: "video",
          title: metadata.title,
          author,
          publishedAt: metadata.uploadedAt,
          texts: [{ kind: "official_subtitle", role: "primary", text: sub.text, language: sub.language }],
          media: [{ kind: "video", role: "context", sourceUrl: thumbnailUrl(metadata.videoId), caption: metadata.title }],
          links: [{ url: identity.canonicalUrl, role: "source" }],
          sourceMetadata: {
            durationSeconds: metadata.durationSeconds ?? null, viewCount: metadata.viewCount ?? null,
            subtitleLanguage: sub.language, subtitleAvailable: true, acquisitionStrategy: "yt-dlp-subtitle-first",
          },
        };
      } catch (error) {
        if (error instanceof PlatformAdapterError && error.code === "rate_limited") throw error;
        ctx.logger.warn(`youtube subtitle download failed, fallback to audio+asr: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return {
      identity,
      contentType: "video",
      title: metadata.title,
      author,
      publishedAt: metadata.uploadedAt,
      texts: metadata.title ? [{ kind: "caption", role: "context", text: metadata.title }] : [],
      media: [{ kind: "video", role: "primary", sourceUrl: thumbnailUrl(metadata.videoId), caption: metadata.title }],
      links: [{ url: identity.canonicalUrl, role: "source" }],
      sourceMetadata: {
        durationSeconds: metadata.durationSeconds ?? null, viewCount: metadata.viewCount ?? null,
        subtitleAvailable: false, acquisitionStrategy: "yt-dlp-audio-asr",
      },
    };
  }

  async materializeMedia(content: NormalizedContent, ctx: PlatformRuntimeContext): Promise<MaterializedMedia[]> {
    return [await downloadYouTubeAudio(content.identity.canonicalUrl, ctx.taskDir, this.config, this.deps)];
  }
}
