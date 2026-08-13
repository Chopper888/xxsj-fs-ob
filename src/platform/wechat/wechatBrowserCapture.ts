import { chromium } from "playwright";
import type { WechatPageSnapshot } from "./wechatTypes.js";
export interface CaptureWechatOptions { inputUrl: string; userDataDir: string; timeoutMs?: number; headless?: boolean }
export async function captureWechatArticleWithBrowser(options: CaptureWechatOptions): Promise<WechatPageSnapshot> {
  const context = await chromium.launchPersistentContext(options.userDataDir, { headless: options.headless ?? false, locale: "zh-CN", viewport: { width: 1280, height: 900 }, args: ["--disable-session-crashed-bubble"] });
  try {
    const page = context.pages()[0] ?? await context.newPage(); await page.goto(options.inputUrl, { waitUntil: "domcontentloaded", timeout: options.timeoutMs ?? 30000 });
    await page.waitForTimeout(1200);
    return await page.evaluate(() => {
      const root = document.querySelector("#js_content") as HTMLElement | null;
      const get = (...selectors: string[]) => selectors.map(s => document.querySelector(s)?.textContent?.trim()).find(Boolean) || "";
      const blocks = root ? [...root.querySelectorAll("h1,h2,h3,h4,p,li,blockquote,pre,code")].map(el => ({ tag: el.tagName.toLowerCase(), text: (el.textContent || "").trim() })).filter(x => x.text) : [];
      const images = root ? [...root.querySelectorAll("img")].map(img => ({ dataSrc: img.getAttribute("data-src") || undefined, src: img.getAttribute("src") || undefined, alt: img.getAttribute("alt") || undefined, contextBefore: img.previousElementSibling?.textContent?.trim().slice(-80), contextAfter: img.nextElementSibling?.textContent?.trim().slice(0, 80), width: img.naturalWidth || undefined, height: img.naturalHeight || undefined })) : [];
      return { url: location.href, title: get("#activity-name", "h1.rich_media_title"), account: get("#js_name", ".rich_media_meta_nickname"), publishedAt: get("#publish_time", "#meta_content em.rich_media_meta_text"), bodyText: root?.innerText.trim() || "", blocks, images, pageText: document.body?.innerText.slice(0, 5000) || "" };
    });
  } finally { await context.close(); }
}
