import type { ParsedWechatArticle, WechatPageSnapshot } from "./wechatTypes.js";
const mime = (url: string) => { const f = new URL(url).searchParams.get("wx_fmt")?.toLowerCase(); return f ? `image/${f === "jpg" ? "jpeg" : f}` : undefined; };
export function parseWechatArticle(page: WechatPageSnapshot): ParsedWechatArticle {
  const parts: string[] = [];
  for (let i = 0; i < page.blocks.length; i++) {
    const b = page.blocks[i]; if (!b.text.trim()) continue;
    if (b.tag === "pre" || b.tag === "code") parts.push(`\`\`\`\n${b.text.trim()}\n\`\`\``);
    else if (b.tag === "li" && page.blocks[i - 1]?.tag === "li") parts[parts.length - 1] += `\n${b.text.trim()}`;
    else parts.push(b.text.trim());
  }
  return { title: page.title.trim(), account: page.account.trim(), publishedAt: page.publishedAt,
    body: parts.length ? parts.join("\n\n") : page.bodyText.trim(),
    images: page.images.filter(img => { const url = img.dataSrc || img.src || ""; const trackingPixel = !img.dataSrc && img.width === 1 && img.height === 1; return Boolean(url) && !url.startsWith("data:") && !trackingPixel && !/二维码|qr\s*code/i.test(img.alt ?? ""); }).map((img, i) => { const sourceUrl = img.dataSrc || img.src || ""; return { sourceUrl, order: i + 1, alt: img.alt || undefined, context: [img.contextBefore, img.contextAfter].filter(Boolean).join(" / ") || undefined, mimeType: sourceUrl ? mime(sourceUrl) : undefined }; }),
  };
}

