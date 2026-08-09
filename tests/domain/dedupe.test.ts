import { describe, expect, it } from "vitest";
import { canonicalDouyinVideoUrl, createDedupeId, extractAwemeId, normalizeUrl } from "../../src/domain/dedupe.js";

describe("dedupe", () => {
  it("extracts aweme id from Douyin video urls", () => {
    expect(extractAwemeId("https://www.douyin.com/video/7650000000000000000?previous_page=app_code_link")).toBe(
      "7650000000000000000",
    );
    expect(extractAwemeId("https://www.douyin.com/?modal_id=7650000000000000000")).toBe("7650000000000000000");
  });

  it("normalizes tracking parameters", () => {
    expect(normalizeUrl("https://www.douyin.com/video/731?utm_source=a&foo=bar")).toBe(
      "https://www.douyin.com/video/731?foo=bar",
    );
  });

  it("canonicalizes Douyin links to the Jingxuan modal entrypoint", () => {
    expect(canonicalDouyinVideoUrl("https://www.douyin.com/jingxuan?modal_id=7650000000000000000")).toBe(
      "https://www.douyin.com/jingxuan?modal_id=7650000000000000000",
    );
    expect(canonicalDouyinVideoUrl("https://www.douyin.com/video/7650000000000000000")).toBe(
      "https://www.douyin.com/jingxuan?modal_id=7650000000000000000",
    );
  });

  it("prefers aweme id over text hash", () => {
    const id = createDedupeId({
      url: "https://www.douyin.com/video/7650000000000000000?x=1",
      text: "same visible text",
      rawSnapshot: "<div>same visible text</div>",
    });

    expect(id).toBe("aweme:7650000000000000000");
  });

  it("falls back to stable text hash", () => {
    const first = createDedupeId({ text: "hello world", rawSnapshot: "" });
    const second = createDedupeId({ text: " hello   world ", rawSnapshot: "different" });

    expect(first).toBe(second);
    expect(first.startsWith("text:")).toBe(true);
  });
});
