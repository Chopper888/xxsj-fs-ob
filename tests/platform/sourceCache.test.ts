import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { loadNormalizedContentCache, saveNormalizedContentCache } from "../../src/platform/sourceCache.js";
import type { NormalizedContent } from "../../src/platform/types.js";

let dir: string;
const content: NormalizedContent = { identity: { platform: "wechat_official_account", platformContentId: "wx1", sourceUrl: "https://mp.weixin.qq.com/s/a", canonicalUrl: "https://mp.weixin.qq.com/s/a", dedupeKey: "wechat:wx1" }, contentType: "article", title: "文章", texts: [{ kind: "body", role: "primary", text: "足够长的公众号文章正文，用于验证缓存不会被空文件冒充。" }], media: [], links: [] };
beforeEach(async () => { dir = join(tmpdir(), `wx-cache-${randomUUID()}`); await mkdir(dir, { recursive: true }); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

describe("normalized source cache", () => {
  it("round-trips a validated article", async () => { await saveNormalizedContentCache(dir, content); expect((await loadNormalizedContentCache(dir, content.identity))?.title).toBe("文章"); });
  it("rejects a cache belonging to another identity", async () => { await saveNormalizedContentCache(dir, content); expect(await loadNormalizedContentCache(dir, { ...content.identity, dedupeKey: "wechat:other" })).toBeNull(); });
  it("does not persist a raw source URL carrying transient query credentials", async () => { const unsafe = { ...content, identity: { ...content.identity, sourceUrl: `${content.identity.canonicalUrl}?pass_ticket=secret` } }; await saveNormalizedContentCache(dir, unsafe); expect((await loadNormalizedContentCache(dir, content.identity))?.identity.sourceUrl).toBe(content.identity.canonicalUrl); });
});
