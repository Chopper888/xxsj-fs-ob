import type { PlatformAdapter, PlatformInput, PlatformRuntimeContext, NormalizedUrl } from "../platformAdapter.js";
import type { NormalizedContent, PlatformIdentity, NormalizedMedia } from "../types.js";
import { acquireXEmbed, parseXEmbed } from "./xEmbed.js";
import { buildXIdentity, isXPostUrl, resolveXTcoShortLink } from "./xUrl.js";
import { resolveXTweetMedia, type XMediaResolverInput, type XMediaResolverOptions } from "./xMediaResolver.js";

export class XAdapter implements PlatformAdapter {
  readonly platform = "x" as const;

  constructor(
    private readonly acquire = acquireXEmbed,
    private readonly resolveUrl: (url: string) => Promise<string> = resolveXTcoShortLink,
    private readonly mediaResolver: (input: XMediaResolverInput, options?: XMediaResolverOptions) => Promise<NormalizedMedia[]> = (input, options) => resolveXTweetMedia(input, options),
  ) {}

  canHandle(i: PlatformInput) {
    return isXPostUrl(i.sourceUrl);
  }

  async normalizeUrl(i: PlatformInput, _c: PlatformRuntimeContext): Promise<NormalizedUrl> {
    const resolved = await this.resolveUrl(i.sourceUrl);
    const x = buildXIdentity(resolved);
    return { sourceUrl: i.sourceUrl, canonicalUrl: x.canonicalUrl, platformContentId: x.platformContentId, dedupeKey: i.dedupeKey };
  }

  async resolveIdentity(n: NormalizedUrl, _c: PlatformRuntimeContext): Promise<PlatformIdentity> {
    const x = buildXIdentity(n.canonicalUrl);
    return n.dedupeKey
      ? { ...x, sourceUrl: n.sourceUrl, dedupeKey: n.dedupeKey, dedupeAliases: [x.dedupeKey] }
      : { ...x, sourceUrl: n.sourceUrl };
  }

  async resolveContent(identity: PlatformIdentity, ctx: PlatformRuntimeContext): Promise<NormalizedContent> {
    const embed = await this.acquire(identity.canonicalUrl);
    const p = parseXEmbed(embed);
    // oEmbed HTML 不给真实图片，用公开 syndication 接口补齐；拿不到则回落 embed 自带 media。
    const enriched = await this.mediaResolver({ postId: p.postId, text: p.text, logger: ctx.logger });
    const media = enriched.length > 0 ? enriched : p.media;
    return {
      identity,
      contentType: "post",
      author: { name: embed.author_name, url: embed.author_url, id: p.handle },
      publishedAt: p.publishedAt,
      texts: [{ kind: "body", role: "primary", text: p.text }],
      media,
      links: [{ url: identity.canonicalUrl, role: "source" }, ...p.links.map(url => ({ url, role: "external" as const }))],
      sourceMetadata: {
        handle: p.handle,
        resolvedEmbedPostId: p.postId,
        embedResolvedDifferentPost: p.postId !== identity.platformContentId,
        acquisitionStrategy: "public-embed-first",
        mediaHint: p.mediaHint,
        quoteMetadataAvailable: false,
        threadDetected: false,
      },
    };
  }
}
