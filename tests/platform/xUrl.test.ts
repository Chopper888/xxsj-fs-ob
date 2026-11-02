import { describe, expect, it, vi } from "vitest";
import { buildXIdentity, isXPostUrl, isXTcoShortLink, parseXUrl, resolveXTcoShortLink } from "../../src/platform/x/xUrl.js";

describe("X 短链 t.co 解析", () => {
  it("识别 t.co 短链并放行 isXPostUrl（推迟到 normalizeUrl 解析）", () => {
    expect(isXTcoShortLink("https://t.co/abc123")).toBe(true);
    expect(isXTcoShortLink("https://x.com/alice/status/123")).toBe(false);
    expect(isXPostUrl("https://t.co/abc123")).toBe(true);
  });

  it("跟随 302 重定向得到真实 status 链接", async () => {
    const f = vi.fn().mockResolvedValue(new Response(null, { status: 302, headers: { location: "https://x.com/xiangxiang103/status/2084806233140437136" } }));
    const resolved = await resolveXTcoShortLink("https://t.co/abc123", f);
    expect(resolved).toBe("https://x.com/xiangxiang103/status/2084806233140437136");
    expect(f).toHaveBeenCalledWith("https://t.co/abc123", expect.objectContaining({ redirect: "manual" }));
  });

  it("支持多跳重定向收敛", async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 301, headers: { location: "https://t.co/hop2" } }))
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: "https://twitter.com/alice/status/42" } }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    expect(await resolveXTcoShortLink("https://t.co/hop1", f)).toBe("https://twitter.com/alice/status/42");
    expect(f).toHaveBeenCalledTimes(3);
  });

  it("无 Location 的 302 报 invalid_url", async () => {
    const f = vi.fn().mockResolvedValue(new Response(null, { status: 302 }));
    await expect(resolveXTcoShortLink("https://t.co/abc", f)).rejects.toMatchObject({ code: "invalid_url" });
  });

  it("非短链原样返回，不发请求", async () => {
    const f = vi.fn();
    expect(await resolveXTcoShortLink("https://x.com/alice/status/123", f)).toBe("https://x.com/alice/status/123");
    expect(f).not.toHaveBeenCalled();
  });
});

describe("X 裸ID 解析（占位 handle）", () => {
  it("纯数字输入按占位 handle i 构造 status 链接", () => {
    expect(parseXUrl("2084806233140437136")).toEqual({ handle: "i", postId: "2084806233140437136" });
    expect(parseXUrl("  123  ")).toEqual({ handle: "i", postId: "123" });
  });

  it("buildXIdentity 对裸ID产出占位 canonical + handle 无关去重键", () => {
    expect(buildXIdentity("2084806233140437136")).toMatchObject({
      canonicalUrl: "https://x.com/i/status/2084806233140437136",
      platformContentId: "2084806233140437136",
      dedupeKey: "x:2084806233140437136",
    });
  });

  it("isXPostUrl 识别裸ID，拒绝非数字串", () => {
    expect(isXPostUrl("2084806233140437136")).toBe(true);
    expect(isXPostUrl("not-an-id")).toBe(false);
    expect(isXPostUrl("123abc456")).toBe(false);
  });
});

describe("X URL 识别优先级", () => {
  it("完整 status 链接 / t.co / 裸ID 均被识别", () => {
    expect(isXPostUrl("https://x.com/alice/status/123")).toBe(true);
    expect(isXPostUrl("https://www.x.com/alice/status/123?s=1")).toBe(true);
    expect(isXPostUrl("https://twitter.com/alice/status/123")).toBe(true);
    expect(isXPostUrl("https://www.twitter.com/alice/status/123")).toBe(true);
    expect(isXPostUrl("https://t.co/abc")).toBe(true);
    expect(isXPostUrl("123")).toBe(true);
  });

  it("个人主页、非X域名、非status路径均不识别", () => {
    expect(isXPostUrl("https://x.com/alice")).toBe(false);
    expect(isXPostUrl("https://x.com/alice/status/abc")).toBe(false);
    expect(isXPostUrl("https://example.com/123")).toBe(false);
    expect(isXPostUrl("https://www.bilibili.com/video/BV1Wy4y167Z9/")).toBe(false);
  });
});
