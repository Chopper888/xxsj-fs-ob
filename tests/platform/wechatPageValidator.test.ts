import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { validateWechatArticlePage, WechatArticleError } from "../../src/platform/wechat/wechatPageValidator.js";
const fixture = (name: string) => JSON.parse(readFileSync(new URL(`../fixtures/wechat/${name}.json`, import.meta.url), "utf8"));

describe("wechat page validator", () => {
  it("accepts a real article-shaped snapshot", () => expect(validateWechatArticlePage(fixture("normal-article"))).toEqual({ valid: true }));
  it.each([
    ["verification-page", "verification_required"],
    ["deleted-page", "article_deleted"],
  ])("classifies %s", (name, code) => {
    expect(() => validateWechatArticlePage(fixture(name))).toThrowError(WechatArticleError);
    try { validateWechatArticlePage(fixture(name)); } catch (error) { expect((error as WechatArticleError).code).toBe(code); }
  });
  it("rejects restricted and empty pages", () => {
    expect(() => validateWechatArticlePage({ ...fixture("normal-article"), bodyText: "", pageText: "访问过于频繁，请稍后再试" })).toThrowError(/access_restricted|rate_limited/);
    expect(() => validateWechatArticlePage({ ...fixture("normal-article"), bodyText: "短" })).toThrowError(/content_empty/);
  });
  it.each([
    ["请登录后继续访问", "auth_required"],
    ["该内容已被发布者删除，无法查看", "article_deleted"],
    ["页面不存在或已被删除", "article_not_found"],
  ])("classifies additional error page: %s", (pageText, code) => {
    try { validateWechatArticlePage({ ...fixture("normal-article"), bodyText: "", pageText }); }
    catch (error) { expect((error as WechatArticleError).code).toBe(code); return; }
    throw new Error("expected typed validation error");
  });
});
