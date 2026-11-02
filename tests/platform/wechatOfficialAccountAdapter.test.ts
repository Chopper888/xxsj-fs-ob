import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { WechatOfficialAccountAdapter } from "../../src/platform/wechat/wechatOfficialAccountAdapter.js";
import { buildWechatIdentity } from "../../src/platform/wechat/wechatUrl.js";
import { chromium } from "playwright";
import { WECHAT_SNAPSHOT_SCRIPT } from "../../src/platform/wechat/wechatBrowserCapture.js";
const fixture = (name: string) => JSON.parse(readFileSync(new URL(`../fixtures/wechat/${name}.json`, import.meta.url), "utf8"));
const context = { taskDir: "data/test-wechat", signal: new AbortController().signal, logger: { info: vi.fn(), warn: vi.fn() } };

describe("WechatOfficialAccountAdapter", () => {
  it("runs the snapshot extractor inside an isolated browser context", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.setContent('<h1 id="activity-name">标题</h1><span id="js_name">账号</span><div id="js_content"><p>这是一段足够长的公众号合成正文，用于验证浏览器执行上下文不会依赖 Node helper。</p></div>');
      const snapshot = await page.evaluate(WECHAT_SNAPSHOT_SCRIPT);
      expect(snapshot).toMatchObject({ title: "标题", account: "账号" });
    } finally { await browser.close(); }
  });
  it("resolves browser capture into article NormalizedContent", async () => {
    const capture = vi.fn().mockResolvedValue(fixture("normal-article"));
    const adapter = new WechatOfficialAccountAdapter({ capture });
    expect(adapter.canHandle({ sourceUrl: "https://mp.weixin.qq.com/s/example-text", declaredPlatform: "公众号" })).toBe(true);
    const normalized = await adapter.normalizeUrl({ sourceUrl: fixture("normal-article").url }, context);
    const identity = await adapter.resolveIdentity(normalized, context);
    const content = await adapter.resolveContent(identity, context);
    expect(capture).toHaveBeenCalledWith(expect.objectContaining({ userDataDir: expect.stringMatching(/[\\/]\.browser[\\/]wechat$/) }));
    expect(content).toMatchObject({ contentType: "article", title: "合成公众号文章", author: { name: "示例公众号" } });
    expect(content.texts[0]).toMatchObject({ kind: "body", role: "primary" });
    expect(content.sourceMetadata).toEqual({ accountName: "示例公众号", imageCount: 0, rawBodyImageCount: 0, imageDiagnostics: null, browserStrategy: "browser-first" });
  });

  it("propagates typed validation errors without Base, AI or Obsidian dependencies", async () => {
    const adapter = new WechatOfficialAccountAdapter({ capture: vi.fn().mockResolvedValue(fixture("verification-page")) });
    const normalized = await adapter.normalizeUrl({ sourceUrl: fixture("verification-page").url }, context);
    const identity = await adapter.resolveIdentity(normalized, context);
    await expect(adapter.resolveContent(identity, context)).rejects.toMatchObject({ code: "verification_required" });
  });
  it("maps browser timeout and uses final URL as canonical identity", async () => {
    const timeout = new WechatOfficialAccountAdapter({ capture: vi.fn().mockRejectedValue(new Error("page.goto: Timeout 30000ms exceeded")) });
    const n = await timeout.normalizeUrl({ sourceUrl: fixture("normal-article").url }, context);
    const i = await timeout.resolveIdentity(n, context);
    await expect(timeout.resolveContent(i, context)).rejects.toMatchObject({ code: "browser_timeout" });

    const redirected = fixture("normal-article"); redirected.url = "https://mp.weixin.qq.com/s/final-article";
    const adapter = new WechatOfficialAccountAdapter({ capture: vi.fn().mockResolvedValue(redirected) });
    const content = await adapter.resolveContent(i, context);
    expect(content.identity.canonicalUrl).toBe("https://mp.weixin.qq.com/s/final-article");
    expect(content.identity.dedupeKey).toBe(buildWechatIdentity(redirected.url).dedupeKey);
  });
  it("preserves an incoming weixin identity and retains canonical WeChat identity as an alias", async () => {
    const capture = vi.fn().mockResolvedValue(fixture("normal-article"));
    const adapter = new WechatOfficialAccountAdapter({ capture });
    const normalized = await adapter.normalizeUrl({ sourceUrl: "https://mp.weixin.qq.com/s/example", dedupeKey: "weixin:example-article-id" }, context);
    const identity = await adapter.resolveIdentity(normalized, context);
    expect(identity.dedupeKey).toBe("weixin:example-article-id");
    expect(identity.dedupeAliases).toContain(buildWechatIdentity(normalized.canonicalUrl).dedupeKey);
    const content = await adapter.resolveContent(identity, context);
    expect(content.identity.dedupeKey).toBe("weixin:example-article-id");
    expect(content.identity.dedupeAliases).toContain(buildWechatIdentity(fixture("normal-article").url).dedupeKey);
  });

  it("uses canonical wechat identity when the incoming record has no dedupe key", async () => {
    const adapter = new WechatOfficialAccountAdapter({ capture: vi.fn().mockResolvedValue(fixture("normal-article")) });
    const normalized = await adapter.normalizeUrl({ sourceUrl: fixture("normal-article").url }, context);
    const identity = await adapter.resolveIdentity(normalized, context);
    expect(identity.dedupeKey).toMatch(/^wechat:[a-f0-9]{64}$/);
  });
});

