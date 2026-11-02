import { chromium } from "playwright";
import type { WechatPageSnapshot } from "./wechatTypes.js";
export interface CaptureWechatOptions { inputUrl: string; userDataDir: string; timeoutMs?: number; headless?: boolean }
export const WECHAT_SNAPSHOT_SCRIPT = `(() => {
  const root = document.querySelector("#js_content");
  const textOf = (selector) => document.querySelector(selector)?.textContent?.trim() || "";
  const title = textOf("#activity-name") || textOf("h1.rich_media_title");
  const account = textOf("#js_name") || textOf(".rich_media_meta_nickname");
  const publishedAt = textOf("#publish_time") || textOf("#meta_content em.rich_media_meta_text");
  const blocks = root ? Array.from(root.querySelectorAll("h1,h2,h3,h4,p,li,blockquote,pre,code")).map(el => ({ tag: el.tagName.toLowerCase(), text: (el.textContent || "").trim() })).filter(x => x.text) : [];
  const images = root ? Array.from(root.querySelectorAll("img")).map(img => ({ dataSrc: img.getAttribute("data-src") || undefined, src: img.getAttribute("src") || undefined, alt: img.getAttribute("alt") || undefined, contextBefore: img.previousElementSibling?.textContent?.trim().slice(-80), contextAfter: img.nextElementSibling?.textContent?.trim().slice(0, 80), width: img.naturalWidth || undefined, height: img.naturalHeight || undefined })) : [];
  const imageDiagnostics = { dataSrc: images.filter(x => x.dataSrc).length, httpSrc: images.filter(x => /^https?:/.test(x.src || "")).length, dataUri: images.filter(x => (x.src || "").startsWith("data:")).length, missing: images.filter(x => !x.dataSrc && !x.src).length };
  return { url: location.href, title, account, publishedAt, bodyText: root?.innerText.trim() || "", blocks, images, imageDiagnostics, pageText: document.body?.innerText.slice(0, 5000) || "" };
})()`;
export async function captureWechatArticleWithBrowser(options: CaptureWechatOptions): Promise<WechatPageSnapshot> {
  const context = await chromium.launchPersistentContext(options.userDataDir, { headless: options.headless ?? false, locale: "zh-CN", viewport: { width: 1280, height: 900 }, args: ["--disable-session-crashed-bubble"] });
  try {
    const page = context.pages()[0] ?? await context.newPage(); await page.goto(options.inputUrl, { waitUntil: "domcontentloaded", timeout: options.timeoutMs ?? 30000 });
    await page.waitForTimeout(1200);
    return await page.evaluate(WECHAT_SNAPSHOT_SCRIPT) as WechatPageSnapshot;
  } finally { await context.close(); }
}

