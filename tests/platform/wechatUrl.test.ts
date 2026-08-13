import { describe, expect, it } from "vitest";
import { buildWechatIdentity, isWechatArticleUrl, normalizeWechatArticleUrl } from "../../src/platform/wechat/wechatUrl.js";

describe("wechat URL and identity", () => {
  it("recognizes only public article URLs", () => {
    expect(isWechatArticleUrl("https://mp.weixin.qq.com/s/abc")).toBe(true);
    expect(isWechatArticleUrl("https://mp.weixin.qq.com/mp/profile_ext?action=home")).toBe(false);
    expect(isWechatArticleUrl("https://weixin.qq.com/s/abc")).toBe(false);
  });

  it("normalizes scheme, host, fragment and known tracking parameters", () => {
    expect(normalizeWechatArticleUrl("http://MP.WEIXIN.QQ.COM/s/abc?scene=1&__biz=x&mid=2&idx=1#wechat_redirect"))
      .toBe("https://mp.weixin.qq.com/s/abc?__biz=x&idx=1&mid=2");
  });

  it("uses stable tuple identity and equivalent URLs share dedupe", () => {
    const a = buildWechatIdentity("https://mp.weixin.qq.com/s/a?__biz=b&mid=2&idx=1&scene=1");
    const b = buildWechatIdentity("https://mp.weixin.qq.com/s/other?idx=1&mid=2&__biz=b#x");
    expect(a.platformContentId).toBe("b:2:1");
    expect(a.dedupeKey).toBe(b.dedupeKey);
  });

  it("falls back to canonical hash and distinguishes articles", () => {
    const a = buildWechatIdentity("https://mp.weixin.qq.com/s/a");
    const b = buildWechatIdentity("https://mp.weixin.qq.com/s/b");
    expect(a.platformContentId).toMatch(/^sha256:/);
    expect(a.dedupeKey).not.toBe(b.dedupeKey);
  });
});
