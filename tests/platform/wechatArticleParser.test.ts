import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseWechatArticle } from "../../src/platform/wechat/wechatArticleParser.js";
const fixture = (name: string) => JSON.parse(readFileSync(new URL(`../fixtures/wechat/${name}.json`, import.meta.url), "utf8"));

describe("wechat article parser", () => {
  it("extracts metadata and preserves structured text", () => {
    const parsed = parseWechatArticle(fixture("complex-article"));
    expect(parsed.title).toBe("复杂正文结构");
    expect(parsed.body).toContain("章节标题\n\n列表一\n列表二");
    expect(parsed.body).toContain("```\nconst answer = 42;\n```");
  });

  it("prefers data-src and preserves image order and context", () => {
    const parsed = parseWechatArticle(fixture("image-article"));
    expect(parsed.images.map(image => image.sourceUrl)).toEqual([
      "https://mmbiz.qpic.cn/a/one?wx_fmt=png",
      "https://mmbiz.qpic.cn/a/two?wx_fmt=jpeg",
    ]);
    expect(parsed.images[0]).toMatchObject({ order: 1, alt: "步骤一", context: "打开设置 / 完成第一步", mimeType: "image/png" });
  });
  it("filters placeholders, tracking pixels and QR decorations", () => {
    const input = fixture("image-article");
    input.images.push(
      { src: "data:image/gif;base64,x", width: 1, height: 1 },
      { src: "https://mmbiz.qpic.cn/a/pixel.gif", width: 1, height: 1 },
      { src: "https://mmbiz.qpic.cn/a/qr.png", alt: "公众号二维码", width: 300, height: 300 },
    );
    expect(parseWechatArticle(input).images).toHaveLength(2);
  });
  it("keeps data-src lazy images whose natural dimensions are not loaded", () => {
    const input = fixture("image-article");
    input.images = [{ dataSrc: "https://mmbiz.qpic.cn/a/lazy?wx_fmt=webp", width: 0, height: 0 }];
    expect(parseWechatArticle(input).images).toMatchObject([{ sourceUrl: "https://mmbiz.qpic.cn/a/lazy?wx_fmt=webp", order: 1 }]);
  });
  it("keeps data-src when the loaded src placeholder is one pixel", () => {
    const input = fixture("image-article");
    input.images = [{ dataSrc: "https://mmbiz.qpic.cn/a/real?wx_fmt=png", src: "data:image/gif;base64,x", width: 1, height: 1 }];
    expect(parseWechatArticle(input).images).toHaveLength(1);
  });
});

