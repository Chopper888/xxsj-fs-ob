import { resolve } from "node:path";
import { PlatformAdapterError, type PlatformAdapter, type PlatformInput, type PlatformRuntimeContext, type NormalizedUrl } from "../platformAdapter.js";
import type { NormalizedContent, PlatformIdentity } from "../types.js";
import { captureWechatArticleWithBrowser, type CaptureWechatOptions } from "./wechatBrowserCapture.js";
import { parseWechatArticle } from "./wechatArticleParser.js";
import { validateWechatArticlePage } from "./wechatPageValidator.js";
import { buildWechatIdentity, isWechatArticleUrl, normalizeWechatArticleUrl } from "./wechatUrl.js";
import type { WechatPageSnapshot } from "./wechatTypes.js";
type Capture = (options: CaptureWechatOptions) => Promise<WechatPageSnapshot>;
export class WechatOfficialAccountAdapter implements PlatformAdapter {
  readonly platform = "wechat_official_account" as const;
  private capture: Capture; private root: string;
  constructor(options: { capture?: Capture; projectRoot?: string; headless?: boolean; timeoutMs?: number } = {}) { this.capture = options.capture ?? captureWechatArticleWithBrowser; this.root = resolve(options.projectRoot ?? process.cwd()); this.headless = options.headless; this.timeoutMs = options.timeoutMs; }
  private headless?: boolean; private timeoutMs?: number;
  canHandle(input: PlatformInput) { return isWechatArticleUrl(input.sourceUrl); }
  async normalizeUrl(input: PlatformInput, _context: PlatformRuntimeContext): Promise<NormalizedUrl> { return { sourceUrl: input.sourceUrl, canonicalUrl: normalizeWechatArticleUrl(input.sourceUrl), dedupeKey: input.dedupeKey }; }
  async resolveIdentity(normalized: NormalizedUrl, _context: PlatformRuntimeContext): Promise<PlatformIdentity> {
    const canonical = buildWechatIdentity(normalized.canonicalUrl);
    if (!normalized.dedupeKey) return { ...canonical, sourceUrl: normalized.sourceUrl };
    return { ...canonical, sourceUrl: normalized.sourceUrl, dedupeKey: normalized.dedupeKey, dedupeAliases: [canonical.dedupeKey] };
  }
  async resolveContent(identity: PlatformIdentity, _context: PlatformRuntimeContext): Promise<NormalizedContent> {
    let page: WechatPageSnapshot;
    try { page = await this.capture({ inputUrl: identity.canonicalUrl, userDataDir: resolve(this.root, ".browser", "wechat"), headless: this.headless, timeoutMs: this.timeoutMs }); }
    catch (error) { const message = error instanceof Error ? error.message : String(error); throw new PlatformAdapterError(/timeout/i.test(message) ? "browser_timeout" : "temporary_network", message.slice(0, 120)); }
    validateWechatArticlePage(page); const parsed = parseWechatArticle(page); const finalIdentity = buildWechatIdentity(page.url);
    const hasExternalDedupe = Boolean(identity.dedupeAliases?.length);
    const primaryDedupe = hasExternalDedupe ? identity.dedupeKey : finalIdentity.dedupeKey;
    const dedupeAliases = [...new Set([...(identity.dedupeAliases ?? []), identity.dedupeKey, finalIdentity.dedupeKey])].filter((key) => key !== primaryDedupe);
    return { identity: { ...finalIdentity, sourceUrl: identity.sourceUrl, dedupeKey: primaryDedupe, ...(dedupeAliases.length ? { dedupeAliases } : {}) }, contentType: "article", title: parsed.title, author: { name: parsed.account }, publishedAt: parsed.publishedAt,
      texts: [{ kind: "body", role: "primary", text: parsed.body, language: "zh-CN" }], media: parsed.images.map(x => ({ kind: "image", role: "context", ...x })), links: [{ url: finalIdentity.canonicalUrl, role: "source" }], sourceMetadata: { accountName: parsed.account, imageCount: parsed.images.length, rawBodyImageCount: page.images.length, imageDiagnostics: page.imageDiagnostics ?? null, browserStrategy: "browser-first" } };
  }
}
