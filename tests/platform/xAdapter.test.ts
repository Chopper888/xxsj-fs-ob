import { describe, it, expect, vi } from "vitest";
import { buildXIdentity, isXPostUrl, resolveXTcoShortLink } from "../../src/platform/x/xUrl.js";
import { XAdapter } from "../../src/platform/x/xAdapter.js";
import { parseXEmbed, acquireXEmbed } from "../../src/platform/x/xEmbed.js";
import { prepareContent } from "../../src/platform/contentPreparation.js";
import type { NormalizedMedia } from "../../src/platform/types.js";

const html = '<blockquote><p lang="en">Hello &amp; world <a href="https://t.co/a">pic.twitter.com/a</a></p>— A (@alice) <a href="https://x.com/alice/status/123?ref=x">August 14, 2026</a></blockquote>';
const embed = { author_name: "Alice", author_url: "https://x.com/alice", html };
const ctx = { taskDir: ".", signal: new AbortController().signal, logger: { info: vi.fn(), warn: vi.fn() } };
const noMedia: (input: { postId: string; text: string }) => Promise<NormalizedMedia[]> = async () => [];

describe("XAdapter", () => {
  it("canonicalizes x.com and twitter.com", () => {
    expect(isXPostUrl("https://twitter.com/Alice/status/123?s=1")).toBe(true);
    expect(buildXIdentity("https://twitter.com/Alice/status/123")).toMatchObject({ canonicalUrl: "https://x.com/Alice/status/123", platformContentId: "123", dedupeKey: "x:123" });
  });
  it("parses text, handle, date and an honest media hint", () => {
    expect(parseXEmbed(embed)).toMatchObject({ text: "Hello & world pic.twitter.com/a", handle: "alice", postId: "123", media: [], mediaHint: true });
  });
  it("rejects media-only embed with explicit typed failure", () => {
    const only = html.replace("Hello &amp; world ", "");
    expect(() => parseXEmbed({ ...embed, html: only })).toThrowError(expect.objectContaining({ code: "media_only_content_unsupported" }));
  });
  it("parses explicit image metadata when embed exposes it", () => {
    expect(parseXEmbed({ ...embed, html: html.replace("Hello &amp; world", '<img src="https://pbs.twimg.com/media/a.jpg">Hello &amp; world') })).toMatchObject({ media: [{ kind: "image", sourceUrl: "https://pbs.twimg.com/media/a.jpg" }] });
  });
  it("outputs post and stays text-first with ASR=0", async () => {
    const a = new XAdapter(async () => embed, undefined, noMedia);
    const c = await a.resolveContent(buildXIdentity("https://x.com/alice/status/123"), ctx);
    const transcribe = vi.fn();
    expect((await prepareContent(c, { materializeMedia: vi.fn(), transcribe })).preparationMode).toBe("text-first");
    expect(transcribe).not.toHaveBeenCalled();
    expect(c.contentType).toBe("post");
  });
  it("resolveContent 用解析器返回的真实图片填充 media（role=context）", async () => {
    const mediaResolver: (input: { postId: string; text: string }) => Promise<NormalizedMedia[]> = async ({ text }) => {
      expect(text).toContain("pic.twitter.com/a");
      return [{ kind: "image", role: "context", sourceUrl: "https://pbs.twimg.com/media/real.jpg", order: 1 }];
    };
    const a = new XAdapter(async () => embed, undefined, mediaResolver);
    const c = await a.resolveContent(buildXIdentity("https://x.com/alice/status/123"), ctx);
    expect(c.media).toEqual([{ kind: "image", role: "context", sourceUrl: "https://pbs.twimg.com/media/real.jpg", order: 1 }]);
  });
  it("maps deleted and protected/login responses", async () => {
    await expect(acquireXEmbed("https://x.com/a/status/1", vi.fn().mockResolvedValue(new Response("", { status: 404 })))).rejects.toMatchObject({ code: "not_found" });
    await expect(acquireXEmbed("https://x.com/a/status/1", vi.fn().mockResolvedValue(new Response("", { status: 403 })))).rejects.toMatchObject({ code: "auth_required" });
  });
});

describe("XAdapter 链接解析扩展（短链/裸ID）", () => {
  it("normalizeUrl 先解析 t.co 短链再构造 identity", async () => {
    const resolveUrl = vi.fn().mockResolvedValue("https://x.com/alice/status/123");
    const a = new XAdapter(async () => embed, resolveUrl, noMedia);
    const n = await a.normalizeUrl({ sourceUrl: "https://t.co/xyz", declaredPlatform: "x" }, ctx);
    expect(resolveUrl).toHaveBeenCalledWith("https://t.co/xyz");
    expect(n.canonicalUrl).toBe("https://x.com/alice/status/123");
    expect(n.platformContentId).toBe("123");
  });
  it("normalizeUrl 对裸ID用占位handle构造 canonical", async () => {
    const a = new XAdapter(async () => embed, undefined, noMedia);
    const n = await a.normalizeUrl({ sourceUrl: "2084806233140437136", declaredPlatform: "x" }, ctx);
    expect(n.canonicalUrl).toBe("https://x.com/i/status/2084806233140437136");
    expect(n.platformContentId).toBe("2084806233140437136");
  });
  it("默认 resolveUrl 为非短链时不发请求", async () => {
    const a = new XAdapter(async () => embed, undefined, noMedia);
    const n = await a.normalizeUrl({ sourceUrl: "https://x.com/alice/status/123", declaredPlatform: "x" }, ctx);
    expect(n.canonicalUrl).toBe("https://x.com/alice/status/123");
  });
  it("裸ID经过 resolveIdentity 后 resolveContent 仍产出 post", async () => {
    const a = new XAdapter(async () => embed, undefined, noMedia);
    const n = await a.normalizeUrl({ sourceUrl: "123", declaredPlatform: "x" }, ctx);
    const id = await a.resolveIdentity(n, ctx);
    const c = await a.resolveContent(id, ctx);
    expect(c.identity.canonicalUrl).toBe("https://x.com/i/status/123");
    expect(c.contentType).toBe("post");
    expect(c.sourceMetadata?.handle).toBe("alice");
  });
});
