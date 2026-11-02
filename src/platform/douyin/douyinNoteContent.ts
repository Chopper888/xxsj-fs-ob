import { chromium } from "playwright";
import { douyinCaptureRateLimiter } from "../../media/douyinRateLimiter.js";
import { DOUYIN_MOBILE_UA } from "../../media/douyinMediaCapture.js";

export const DOUYIN_NOTE_SHARE_HOST = "m.douyin.com";

// 从抖音内容 URL 提取 19 位 aweme_id（兼容 /video/ /note/ /article/ 与 ?modal_id=）
export function extractDouyinAwemeId(url: string): string | undefined {
  const modal = url.match(/[?&]modal_id=(\d{8,})/);
  const path = url.match(/\/(?:video|note|article)\/(\d{8,})/);
  return modal?.[1] ?? path?.[1];
}

export function isDouyinNoteUrl(url: string): boolean {
  return /\/note\/\d{8,}/.test(url);
}

export function isDouyinArticleUrl(url: string): boolean {
  return /\/article\/\d{8,}/.test(url);
}

export function isDouyinNoteOrArticleUrl(url: string): boolean {
  return isDouyinNoteUrl(url) || isDouyinArticleUrl(url);
}

export interface DouyinNoteImage {
  sourceUrl: string;
  width?: number;
  height?: number;
}

export interface DouyinNoteContent {
  contentType: "article";
  kind: "image_text" | "article";
  awemeId: string;
  desc: string;
  images: DouyinNoteImage[];
  author: string;
  publishedAt?: string;
}

// 页面内嵌脚本：从 m.douyin.com 分享页的 window._ROUTER_DATA 递归找 aweme 详情。
// 用字符串形式执行，避免 tsx 对函数定义的 __name 转换在浏览器上下文报错。
const DOUYIN_NOTE_EXTRACT_SCRIPT = `(() => {
  const rd = window._ROUTER_DATA;
  if (!rd || typeof rd !== "object") return { ok: false, reason: "router_data_missing" };
  function find(obj, depth) {
    if (!obj || typeof obj !== "object" || depth > 10) return null;
    if (Array.isArray(obj)) { for (const v of obj) { const r = find(v, depth + 1); if (r) return r; } return null; }
    if (typeof obj.desc === "string" && (Array.isArray(obj.images) || obj.video || obj.article_info)) return obj;
    for (const v of Object.values(obj)) { const r = find(v, depth + 1); if (r) return r; }
    return null;
  }
  const aw = find(rd, 0);
  if (!aw) return { ok: false, reason: "aweme_not_found" };
  const images = (Array.isArray(aw.images) ? aw.images : []).map((im) => ({
    uri: im.uri,
    url: Array.isArray(im.url_list) ? im.url_list[0] : undefined,
    width: im.width,
    height: im.height,
  })).filter((im) => im.url);
  return {
    ok: true,
    aweme_id: aw.aweme_id,
    desc: typeof aw.desc === "string" ? aw.desc : "",
    create_time: typeof aw.create_time === "number" ? aw.create_time : undefined,
    author_nickname: aw.author && aw.author.nickname,
    images,
    has_video: Boolean(aw.video && typeof aw.video === "object" && (aw.video.play_addr || aw.video.bit_rate)),
    has_article_info: Boolean(aw.article_info && typeof aw.article_info === "object"),
    article_info_text: aw.article_info && typeof aw.article_info === "object"
      ? (typeof aw.article_info.article_content === "string" ? aw.article_info.article_content : (typeof aw.article_info.content === "string" ? aw.article_info.content : ""))
      : "",
  };
})()`;

export interface DouyinNoteCaptureOptions {
  inputUrl: string;
  userDataDir: string;
  headless?: boolean;
  timeoutMs?: number;
}

interface RawNoteSnapshot {
  ok: boolean;
  reason?: string;
  aweme_id?: string;
  desc?: string;
  create_time?: number;
  author_nickname?: string;
  images?: Array<{ uri: string; url: string; width?: number; height?: number }>;
  has_video?: boolean;
  has_article_info?: boolean;
  article_info_text?: string;
}

async function captureDouyinNoteSnapshot(options: DouyinNoteCaptureOptions): Promise<RawNoteSnapshot> {
  const context = await chromium.launchPersistentContext(options.userDataDir, {
    headless: options.headless ?? false,
    args: ["--disable-session-crashed-bubble", "--window-position=-32000,-32000", "--window-size=430,860", "--start-minimized"],
    viewport: { width: 390, height: 844 },
    userAgent: DOUYIN_MOBILE_UA,
    locale: "zh-CN",
  });
  try {
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto(options.inputUrl, { waitUntil: "domcontentloaded", timeout: options.timeoutMs ?? 30000 });
    await page.waitForTimeout(1500);
    const snapshot = await page.evaluate(DOUYIN_NOTE_EXTRACT_SCRIPT) as RawNoteSnapshot;
    return snapshot;
  } finally {
    await context.close();
  }
}

// 字段判定内容类型：images[] 非空→图文（图文 note 的 video 字段非空，是图集占位，故先判 images）；article_info→文章；否则 video。
export function classifyDouyinNoteContent(snapshot: RawNoteSnapshot): "image_text" | "article" | "video" {
  if (Array.isArray(snapshot.images) && snapshot.images.length > 0) return "image_text";
  if (snapshot.has_article_info) return "article";
  if (snapshot.has_video) return "video";
  return "video";
}

export async function resolveDouyinNoteContent(options: DouyinNoteCaptureOptions): Promise<DouyinNoteContent> {
  douyinCaptureRateLimiter.consume();
  const snapshot = await captureDouyinNoteSnapshot(options);
  if (!snapshot.ok) {
    throw new Error(`douyin_note_ssr_${snapshot.reason ?? "failed"}`);
  }
  const kind = classifyDouyinNoteContent(snapshot);
  if (kind === "video") {
    throw new Error("douyin_note_resolved_to_video");
  }
  const desc = (snapshot.desc ?? "").trim();
  if (kind === "article" && !(snapshot.article_info_text ?? "").trim()) {
    throw new Error("douyin_article_text_missing");
  }
  if (kind === "image_text" && !desc) {
    throw new Error("douyin_note_desc_empty");
  }
  const primaryText = kind === "article" ? (snapshot.article_info_text ?? "") : desc;
  return {
    contentType: "article",
    kind,
    awemeId: snapshot.aweme_id ?? "",
    desc: primaryText,
    images: (snapshot.images ?? []).map((im) => ({ sourceUrl: im.url, width: im.width, height: im.height })),
    author: snapshot.author_nickname ?? "",
    publishedAt: snapshot.create_time ? new Date(snapshot.create_time * 1000).toISOString() : undefined,
  };
}
