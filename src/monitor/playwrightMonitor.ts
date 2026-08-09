import { chromium, type Locator, type Page } from "playwright";
import { execFile } from "node:child_process";
import { stableHash } from "../domain/dedupe.js";
import type { MessageSnapshot } from "../domain/types.js";

export interface DomMessageModel {
  html: string;
  title?: string;
  text: string;
  links: string[];
  images: string[];
  timestamp?: string;
}

export interface MonitorOptions {
  inboxUrl: string;
  messageSelector: string;
  openMessageText?: string;
  openChatText?: string;
  userDataDir: string;
  headless: boolean;
  offscreen: boolean;
}

export function browserLaunchArgs(options: Pick<MonitorOptions, "headless" | "offscreen">): string[] {
  const args = ["--disable-session-crashed-bubble"];
  if (!options.headless) {
    if (options.offscreen) {
      args.push("--window-position=-32000,-32000", "--window-size=900,700", "--start-minimized");
    } else {
      // Always force position/size in visible mode to override any off-screen coords
      // saved in the persistent profile from a previous offscreen run.
      args.push("--window-position=100,100", "--window-size=1280,800");
    }
  }
  return args;
}

export function snapshotsFromDomModels(models: DomMessageModel[]): MessageSnapshot[] {
  return models.map((model) => ({
    snapshotId: `dom:${stableHash(JSON.stringify(model))}`,
    html: model.html,
    title: model.title,
    text: model.text,
    links: model.links,
    images: model.images,
    timestamp: model.timestamp,
  }));
}

function visibleTextSelector(text: string): string {
  const escaped = text.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `:text("${escaped}"):visible`;
}

export function selectShareCoverImage(images: string[]): string | undefined {
  const nonAvatarImages = images.filter((image) => !/avatar|100x100/i.test(image));
  return (
    nonAvatarImages.find((image) => /image-cut|aweme_detail|pcweb_cover|PackSourceEnum_AWEME_DETAIL/i.test(image)) ??
    nonAvatarImages[0] ??
    images[0]
  );
}

export function isLikelyChatDetailRect(rect: { left: number; width: number; height: number }, viewportWidth: number): boolean {
  return rect.width > 0 && rect.height > 0 && rect.left > viewportWidth * 0.55;
}

export function isUnresolvedDouyinShareCard(snapshot: MessageSnapshot): boolean {
  return (
    snapshot.html.includes("MessageItemShareAwemecontainer") &&
    !snapshot.links.some((link) => link.includes("modal_id=") || link.includes("/video/"))
  );
}

function cleanCandidateText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function isDouyinCaptionChromeLine(value: string): boolean {
  return (
    /^合集\s*(?:·|[:：])/.test(value) ||
    /^识别画面(?:\s|$)/.test(value) ||
    /^个人观点(?:[，,]\s*)?仅供参考(?:\s|$)/.test(value)
  );
}

function stripDouyinAuthorMetadataPrefix(value: string): string {
  return value
    .replace(
      /^@[^·•\n]{1,80}\s*[·•]\s*(?:刚刚|昨天|前天|\d+\s*(?:秒|分钟|小时|天|周|个月|月|年)前|\d{1,2}\s*月\s*\d{1,2}\s*日)(?:\s+|$)/,
      "",
    )
    .trim();
}

function stripDouyinTitleChrome(value: string, author?: string): string {
  const authorText = cleanCandidateText(author ?? "").replace(/^@/, "");
  const blockedLines = new Set([
    "详情",
    "TA的作品",
    "评论",
    "问AI",
    "相关推荐",
    "相关推荐",
  ]);
  const lines = value
    .split(/\n+/)
    .map((line) => cleanCandidateText(line))
    .map((line) => stripDouyinAuthorMetadataPrefix(line))
    .filter(Boolean)
    .filter((line) => !blockedLines.has(line))
    .filter((line) => !isDouyinCaptionChromeLine(line))
    .filter((line) => {
      return !(authorText && new RegExp(`^@?${authorText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*·`).test(line));
    });
  const joined = lines.join(" ");
  return authorText
    ? joined.replace(new RegExp(`^@?${authorText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*·\\s*\\S+\\s+`), "")
    : joined.replace(/^@[^·]{1,60}\s*·\s*\S+\s+/, "");
}

function normalizeDouyinTitleCandidate(value: string, author?: string): string {
  return stripDouyinAccountChrome(cleanCandidateText(stripDouyinTitleChrome(value, author)))
    .replace(/^详情\s+TA的作品\s+评论\s+问AI\s+相关推荐\s+/, "")
    .replace(/[.…\s]*版本过低，升级后可展示全部信息/g, "")
    .replace(/[.…\s]+(展开|收起)\s+/g, " ")
    .replace(/[.…\s]+(展开|收起)$/g, "")
    .replace(/\s+合集\s*·[\s\S]*$/, "")
    .replace(/\s+识别画面(?:\s+[\s\S]*)?$/, "")
    .replace(/\s+个人观点(?:[，,]\s*)?仅供参考[\s\S]*$/, "")
    .replace(/^\d{1,2}:\d{2}(?:\/\d{1,2}:\d{2})?\s+/, "")
    .replace(/^\d+(\.\d+)?[万wW]?\s+/, "")
    .replace(/\s+@.+$/, "")
    .replace(/\s+·\s*\S+$/, "")
    .trim();
}

function stripDouyinAccountChrome(value: string): string {
  return value
    .replace(/^.{0,80}?关注\d+\s*粉丝\d+\s*我的喜欢\d+\s*/, "")
    .replace(/\s*我的收藏\d+\s*观看历史\d+天内稍后再看\d+\s*我的作品\d+\s*我的预约我的订单退出登录\s*$/, "");
}

function isLikelyDouyinMessageNoise(candidate: string): boolean {
  if (candidate.includes("视频无法查看")) return true;
  if (candidate.includes("撤回了一条消息")) return true;
  if (candidate.includes("海量优质视频内容")) return true;
  if (candidate.includes("你想要的好内容，都在抖音精选")) return true;
  if (candidate.includes("系列合集内容连续看")) return true;

  const messageTimeMarkers = ["刚刚", "分钟前", "小时前", "昨天", "前天"];
  const markerCount = messageTimeMarkers.filter((marker) => candidate.includes(marker)).length;
  return markerCount >= 3;
}

export function selectDouyinVideoTitle(candidates: string[], author?: string): string | undefined {
  const authorText = cleanCandidateText(author ?? "");
  const blockedExact = new Set([
    "",
    authorText,
    "关注",
    "已关注",
    "评论",
    "分享",
    "收藏",
    "点赞",
    "搜索",
    "首页",
    "推荐",
    "消息",
    "朋友",
    "我的",
    "更多",
    "关闭",
    "展开",
    "收起",
    "复制链接",
  ]);

  const scored = candidates
    .map((raw, index) => {
      const candidate = normalizeDouyinTitleCandidate(raw, author);
      const hashtagCount = candidate.match(/#/g)?.length ?? 0;
      const isDetailPanel = raw.includes("详情") && raw.includes("TA的作品");
      const mentionsAuthor = authorText && raw.includes(authorText);
      return {
        candidate,
        score: candidate.length + hashtagCount * 20 + (isDetailPanel ? 1000 : 0) + (mentionsAuthor ? 400 : 0) - index * 0.01,
      };
    })
    .filter(({ candidate }) => candidate.length >= 6 && candidate.length <= 500)
    .filter(({ candidate }) => !blockedExact.has(candidate))
    .filter(({ candidate }) => !/^\d+(\.\d+)?[万wW]?$/.test(candidate))
    .filter(({ candidate }) => !/^\d{1,2}:\d{2}(\/\d{1,2}:\d{2})?$/.test(candidate))
    .filter(({ candidate }) => !candidate.includes("抖音精选电脑版"))
    .filter(({ candidate }) => !candidate.includes("抖音旗下优质视频平台"))
    .filter(({ candidate }) => !isLikelyDouyinMessageNoise(candidate));

  const textCandidates = scored.filter(({ candidate }) => !/^#/.test(candidate));
  const hashtagCandidates = scored.filter(({ candidate }) => /^#/.test(candidate));
  const bestText = textCandidates.sort((left, right) => right.score - left.score)[0]?.candidate;

  if (!bestText) return undefined;
  if (bestText.includes("#")) return bestText;

  const bestHashtags = hashtagCandidates.sort((left, right) => right.score - left.score)[0]?.candidate;
  return bestHashtags ? `${bestText} ${bestHashtags}` : bestText;
}

function extractAwemeIdFromUrl(url: string): string | undefined {
  return url.match(/[?&]modal_id=(\d{8,})/)?.[1] ?? url.match(/\/video\/(\d{8,})/)?.[1];
}

export function selectDouyinAwemeDetailTitle(payload: unknown, awemeId?: string): string | undefined {
  const detail = findAwemeDetail(payload, awemeId);
  if (!detail) return undefined;

  const desc = typeof detail.desc === "string" ? detail.desc : undefined;
  if (!desc) return undefined;

  const author = detail.author && typeof detail.author === "object" ? (detail.author as Record<string, unknown>) : undefined;
  const authorName = typeof author?.nickname === "string" ? author.nickname : undefined;
  return selectDouyinVideoTitle([desc], authorName);
}

export function selectBestDouyinTitleForCurrentVideo(apiTitle?: string, domTitle?: string): string | undefined {
  if (!apiTitle) return domTitle;
  if (!domTitle) return apiTitle;
  if (domTitle.length <= apiTitle.length) return apiTitle;

  const normalizedApi = normalizeTitleForComparison(apiTitle);
  const normalizedDom = normalizeTitleForComparison(domTitle);
  const apiPrefix = normalizedApi.replace(/^第?\d+[个条期集]*/, "").slice(0, 18);
  const domMatchesApi = apiPrefix.length >= 8 && normalizedDom.includes(apiPrefix);
  const apiLooksTruncated = apiTitle.includes("……") || apiTitle.includes("...") || apiTitle.includes("版本过低");

  if (domMatchesApi && (apiLooksTruncated || domTitle.includes("#") || domTitle.length > apiTitle.length + 20)) {
    return domTitle;
  }
  return apiTitle;
}

function normalizeTitleForComparison(value: string): string {
  return value
    .replace(/\s+/g, "")
    .replace(/[，。！？、,.!?:：；;“”"‘’'（）()[\]【】]/g, "")
    .toLowerCase();
}

function findAwemeDetail(payload: unknown, awemeId?: string): Record<string, unknown> | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  if (Array.isArray(payload)) {
    for (const item of payload) {
      const found = findAwemeDetail(item, awemeId);
      if (found) return found;
    }
    return undefined;
  }

  const object = payload as Record<string, unknown>;
  const directId = object.aweme_id ?? object.awemeId ?? object.id;
  const hasDesc = typeof object.desc === "string" && object.desc.trim().length > 0;
  const idMatches = !awemeId || directId === awemeId || String(directId ?? "") === awemeId;
  if (hasDesc && idMatches) return object;

  for (const value of Object.values(object)) {
    const found = findAwemeDetail(value, awemeId);
    if (found) return found;
  }
  return undefined;
}

async function fetchDouyinVideoTitleFromDetailApi(page: Page, modalUrl: string): Promise<string | undefined> {
  const awemeId = extractAwemeIdFromUrl(modalUrl);
  if (!awemeId) return undefined;

  const payload = await page
    .evaluate(async (id) => {
      const endpoint = new URL("/aweme/v1/web/aweme/detail/", window.location.origin);
      endpoint.searchParams.set("aweme_id", id);
      endpoint.searchParams.set("aid", "6383");
      endpoint.searchParams.set("device_platform", "webapp");

      const response = await fetch(endpoint.toString(), {
        credentials: "include",
        headers: { accept: "application/json" },
      });
      if (!response.ok) return undefined;
      return response.json();
    }, awemeId)
    .catch(() => undefined);

  return selectDouyinAwemeDetailTitle(payload, awemeId);
}

async function extractDouyinVideoTitle(page: Page, author?: string): Promise<string | undefined> {
  const candidates = await page.evaluate(() => {
    const detailPanelText = Array.from(document.querySelectorAll<HTMLElement>("div,section,aside"))
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        const text = (element.innerText || element.textContent || "").trim();
        return (
          rect.width > 0 &&
          rect.height > 0 &&
          text.includes("详情") &&
          text.includes("TA的作品") &&
          text.includes("#") &&
          text.length >= 20 &&
          text.length <= 800
        );
      })
      .sort((left, right) => {
        const leftArea = left.getBoundingClientRect().width * left.getBoundingClientRect().height;
        const rightArea = right.getBoundingClientRect().width * right.getBoundingClientRect().height;
        return leftArea - rightArea;
      })
      .map((element) => element.innerText || element.textContent || "");

    const captionText = Array.from(document.querySelectorAll<HTMLElement>("div,section,aside,p,span"))
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        const text = (element.innerText || element.textContent || "").trim();
        return (
          rect.width > 0 &&
          rect.height > 0 &&
          text.includes("#") &&
          text.length >= 20 &&
          text.length <= 800 &&
          !text.includes("相关推荐") &&
          !text.includes("视频无法查看") &&
          !text.includes("撤回了一条消息")
        );
      })
      .sort((left, right) => {
        const leftArea = left.getBoundingClientRect().width * left.getBoundingClientRect().height;
        const rightArea = right.getBoundingClientRect().width * right.getBoundingClientRect().height;
        return leftArea - rightArea;
      })
      .map((element) => element.innerText || element.textContent || "");

    const metaText = Array.from(document.querySelectorAll<HTMLMetaElement>("meta"))
      .filter((meta) => ["og:title", "twitter:title", "description"].includes(meta.getAttribute("property") ?? meta.name))
      .map((meta) => meta.content)
      .filter(Boolean);

    return [...detailPanelText, ...captionText, ...metaText, document.title];
  });

  return selectDouyinVideoTitle(candidates, author);
}

async function expandDouyinVideoCaption(page: Page): Promise<boolean> {
  const clicked = await page
    .evaluate(() => {
      function isVisible(element: HTMLElement): boolean {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
      }

      function scoreExpandTarget(element: HTMLElement): number {
        let score = 0;
        let cursor: HTMLElement | null = element;
        for (let depth = 0; cursor && depth < 6; depth += 1) {
          const text = (cursor.innerText || cursor.textContent || "").trim();
          const rect = cursor.getBoundingClientRect();
          if (text.length >= 20 && text.length <= 1200) {
            if (text.includes("@")) score += 10;
            if (text.includes("·")) score += 8;
            if (text.includes("#")) score += 6;
            if (text.includes("作者声明")) score -= 6;
            if (text.includes("评论")) score -= 4;
            if (rect.left < window.innerWidth * 0.7) score += 2;
          }
          cursor = cursor.parentElement;
        }
        return score;
      }

      const targets = Array.from(document.querySelectorAll<HTMLElement>("button,span,div"))
        .filter((element) => (element.innerText || element.textContent || "").trim() === "展开")
        .filter(isVisible)
        .sort((left, right) => scoreExpandTarget(right) - scoreExpandTarget(left));

      const target = targets[0];
      if (!target) return false;
      target.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }));
      target.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window }));
      target.click();
      return true;
    })
    .catch(() => false);

  if (clicked) {
    await page.waitForTimeout(500).catch(() => undefined);
  }
  return clicked;
}

async function minimizeChromiumWindow(page: Page): Promise<void> {
  const session = await page.context().newCDPSession(page);
  try {
    const { windowId } = await session.send("Browser.getWindowForTarget");
    await session.send("Browser.setWindowBounds", {
      windowId,
      bounds: { windowState: "minimized" },
    });
  } finally {
    await session.detach().catch(() => undefined);
  }
}

async function hideMacChromiumApp(): Promise<void> {
  if (process.platform !== "darwin") return;

  await new Promise<void>((resolve) => {
    execFile(
      "osascript",
      ["-e", 'tell application "System Events" to set visible of process "Google Chrome for Testing" to false'],
      () => resolve(),
    );
  });
}

export async function hideBrowserIfRequested(
  page: Page,
  options: Pick<MonitorOptions, "offscreen" | "headless">,
): Promise<void> {
  if (!options.offscreen || options.headless) return;

  await minimizeChromiumWindow(page).catch((error) => {
    const message = error instanceof Error ? error.message.split("\n")[0] : "unknown";
    console.warn(`hide_browser_warning:minimize:${message}`);
  });
  await hideMacChromiumApp().catch((error) => {
    const message = error instanceof Error ? error.message.split("\n")[0] : "unknown";
    console.warn(`hide_browser_warning:mac:${message}`);
  });
}

async function markShareCardByImage(page: Page, imageSrc: string, marker: string): Promise<boolean> {
  return page.evaluate(
    ({ imageSrc, marker }) => {
      const cards = Array.from(document.querySelectorAll<HTMLElement>('[data-e2e="msg-item-content"]'));
      const matchingCards = cards.filter((card) => {
        const rect = card.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0 || rect.left <= window.innerWidth * 0.55) return false;

        return Array.from(card.querySelectorAll<HTMLImageElement>("img")).some(
          (image) => image.currentSrc === imageSrc || image.src === imageSrc,
        );
      });
      const matchingCard = matchingCards.at(-1);
      if (!matchingCard) return false;

      matchingCard.setAttribute("data-capture-target", marker);
      return true;
    },
    { imageSrc, marker },
  );
}

async function clearShareCardMarker(page: Page, marker: string): Promise<void> {
  await page
    .evaluate((marker) => {
      document
        .querySelectorAll<HTMLElement>('[data-capture-target]')
        .forEach((element) => {
          if (element.getAttribute("data-capture-target") === marker) {
            element.removeAttribute("data-capture-target");
          }
        });
    }, marker)
    .catch(() => undefined);
}

function isDouyinVideoUrl(url: string): boolean {
  return url.includes("modal_id=") || url.includes("/video/");
}

async function waitForDouyinVideoUrl(page: Page): Promise<string | undefined> {
  await page
    .waitForFunction(() => location.href.includes("modal_id=") || location.href.includes("/video/"), undefined, {
      timeout: 2500,
    })
    .catch(() => undefined);

  const url = page.url();
  return isDouyinVideoUrl(url) ? url : undefined;
}

async function clickCardAndReadVideoUrl(page: Page, card: Locator): Promise<{ url?: string; error?: string }> {
  const targets = [
    card.locator('[class*="MessageItemShareAwemecontainer"] img').first(),
    card.locator('[class*="MessageItemShareAwemecontainer"]').first(),
    card,
  ];
  let lastError: string | undefined;

  for (const target of targets) {
    if ((await target.count()) === 0) continue;

    try {
      await target.scrollIntoViewIfNeeded({ timeout: 1000 }).catch(() => undefined);

      await target.click({ timeout: 2500 });
      let url = await waitForDouyinVideoUrl(page);
      if (url) return { url };

      await target.click({ force: true, timeout: 2500 });
      url = await waitForDouyinVideoUrl(page);
      if (url) return { url };

      const box = await target.boundingBox();
      if (box) {
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        url = await waitForDouyinVideoUrl(page);
        if (url) return { url };
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message.split("\n")[0] : "unknown";
    }
  }

  return { error: lastError };
}

async function clickConversationByText(page: Page, text: string): Promise<boolean> {
  const clickedByClass = await page.evaluate((conversationText) => {
    const nodes = Array.from(document.querySelectorAll<HTMLElement>('[class*="conversationConversationItemwrapper"]'));
    const target = nodes.find((node) => (node.innerText || node.textContent || "").includes(conversationText));
    if (!target) return false;

    target.scrollIntoView({ block: "center" });
    target.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }));
    target.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window }));
    target.click();
    return true;
  }, text);
  if (clickedByClass) return true;

  const textTarget = page.getByText(text, { exact: true }).first();
  if ((await textTarget.count()) === 0) return false;

  await textTarget.click({ timeout: 5000 });
  return true;
}

async function waitForConversationList(page: Page, timeout = 8000): Promise<boolean> {
  return page
    .locator('[class*="conversationConversationItemwrapper"]')
    .first()
    .waitFor({ timeout })
    .then(() => true)
    .catch(() => false);
}

export async function collectMessageSnapshots(page: Page, messageSelector: string): Promise<MessageSnapshot[]> {
  const models = await page.locator(messageSelector).evaluateAll((nodes) =>
    Array.from(
      new Set(
        nodes
          .filter((node) => {
            const rect = (node as HTMLElement).getBoundingClientRect();
            return rect.width > 0 && rect.height > 0 && rect.left > window.innerWidth * 0.55;
          })
          .map((node) => {
          const startElement = node as HTMLElement;
          let element = startElement;
          let candidate = startElement;
          const originalText = (element.innerText || element.textContent || "").trim();

          while (element.parentElement) {
            const parent = element.parentElement;
            const parentText = (parent.innerText || parent.textContent || "").trim();
            const rect = parent.getBoundingClientRect();
            const className = String(parent.className);
            if (!parentText.includes(originalText)) break;
            if (parentText.length > 300 || rect.width > 620 || rect.height > 240) break;

            if (
              className.includes("conversationConversationItem") ||
              className.includes("ConversationItem") ||
              (rect.width > 120 && rect.height > 20)
            ) {
              candidate = parent;
            }
            element = parent;
          }

          return candidate;
        }),
      ),
    )
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && rect.left > window.innerWidth * 0.55;
      })
      .map((element) => {
        return {
          html: element.innerHTML,
          text: element.innerText || element.textContent || "",
          links: Array.from(element.querySelectorAll("a"))
            .map((anchor) => anchor.href)
            .filter(Boolean),
          images: Array.from(element.querySelectorAll("img"))
            .map((image) => image.currentSrc || image.src)
            .filter(Boolean),
          timestamp:
            element.getAttribute("data-time") ??
            element.querySelector("time")?.getAttribute("datetime") ??
            undefined,
        };
      }),
  );

  return snapshotsFromDomModels(models);
}

async function restoreInboxAfterVideoNavigation(page: Page, originalUrl: string, options: MonitorOptions): Promise<void> {
  await page.keyboard.press("Escape").catch(() => undefined);
  await page.waitForTimeout(500).catch(() => undefined);

  if (page.url() !== originalUrl) {
    await page.goBack({ waitUntil: "domcontentloaded", timeout: 8000 }).catch(() => undefined);
  }
  if (page.url() !== originalUrl) {
    await page.goto(originalUrl, { waitUntil: "domcontentloaded", timeout: 8000 }).catch(() => undefined);
  }

  await hideBrowserIfRequested(page, options);

  const hasConversationList = await waitForConversationList(page, 2500);
  if (!hasConversationList && options.openMessageText) {
    await page.locator(visibleTextSelector(options.openMessageText)).last().click({ timeout: 5000 }).catch(() => undefined);
    await waitForConversationList(page, 5000);
  }

  if (options.openChatText) {
    await clickConversationByText(page, options.openChatText).catch(() => false);
    await page.waitForTimeout(1000).catch(() => undefined);
  }

  await hideBrowserIfRequested(page, options);
}

export async function enrichShareCardSnapshot(
  page: Page,
  snapshot: MessageSnapshot,
  options: MonitorOptions,
): Promise<MessageSnapshot> {
  if (page.isClosed()) return snapshot;
  if (!snapshot.html.includes("MessageItemShareAwemecontainer")) return snapshot;
  if (snapshot.links.some((link) => link.includes("modal_id=") || link.includes("/video/"))) return snapshot;

  const currentUrl = page.url();
  if (isDouyinVideoUrl(currentUrl)) {
    await restoreInboxAfterVideoNavigation(page, options.inboxUrl, options);
  }

  const originalUrl = page.url();
  const marker = `capture-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const coverImage = selectShareCoverImage(snapshot.images);
  let card: Locator | undefined;

  if (coverImage && (await markShareCardByImage(page, coverImage, marker))) {
    card = page.locator(`[data-capture-target="${marker}"]`).last();
  }

  if (!card) return snapshot;
  if ((await card.count()) === 0) return snapshot;

  let lastClickError: string | undefined;
  try {
    let clickResult = await clickCardAndReadVideoUrl(page, card);
    await hideBrowserIfRequested(page, options);
    let modalUrl = clickResult.url;
    lastClickError = clickResult.error;

    if (!modalUrl && lastClickError) {
      console.warn(`enrich_share_card_warning:${lastClickError}`);
    }

    if (modalUrl) {
      await expandDouyinVideoCaption(page);
    }

    const title = modalUrl
      ? selectBestDouyinTitleForCurrentVideo(
          await fetchDouyinVideoTitleFromDetailApi(page, modalUrl),
          await extractDouyinVideoTitle(page, snapshot.text),
        )
      : undefined;
    const links = modalUrl ? [...snapshot.links, modalUrl] : snapshot.links;

    if (page.url() !== originalUrl) {
      await page.keyboard.press("Escape").catch(() => undefined);
      await page.waitForTimeout(500);
      await hideBrowserIfRequested(page, options);
    }

    return {
      ...snapshot,
      title: title ?? snapshot.title,
      links,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message.split("\n")[0] : "unknown";
    console.warn(`enrich_share_card_warning:${message}`);
    await restoreInboxAfterVideoNavigation(page, originalUrl, options);
    return snapshot;
  } finally {
    await clearShareCardMarker(page, marker);
  }
}

const BLOCKING_OVERLAY_SELECTORS = [
  'div[id^="login-full-panel"]',
  'div[id*="second-verify"]',
] as const;

// Combined CSS selector list — Playwright treats this as "match any".
const BLOCKING_OVERLAY_CSS = BLOCKING_OVERLAY_SELECTORS.join(", ");

async function findVisibleOverlay(page: Page): Promise<string | undefined> {
  for (const selector of BLOCKING_OVERLAY_SELECTORS) {
    if (await page.locator(selector).isVisible().catch(() => false)) return selector;
  }
  return undefined;
}

async function waitForLoginIfNeeded(page: Page): Promise<void> {
  // Phase 1: give the SPA up to 5 s to inject a login overlay.
  // domcontentloaded fires before React/Vue renders the login panel, so we
  // must actively wait here rather than doing a single isVisible() snapshot.
  const INITIAL_DETECT_MS = 5_000;
  const TOTAL_WAIT_MS = 180_000;
  const POLL_MS = 500;

  const overlayAppeared = await page
    .locator(BLOCKING_OVERLAY_CSS)
    .first()
    .waitFor({ state: "visible", timeout: INITIAL_DETECT_MS })
    .then(() => true)
    .catch(() => false);

  if (!overlayAppeared) return; // already logged in, no overlay within 5 s

  // Phase 2: poll until every overlay clears.
  const deadline = Date.now() + TOTAL_WAIT_MS;
  let lastLoggedSelector = "";

  while (Date.now() < deadline) {
    const blocking = await findVisibleOverlay(page);
    if (!blocking) {
      console.log("login_completed");
      return;
    }
    if (blocking !== lastLoggedSelector) {
      lastLoggedSelector = blocking;
      console.log(`login_overlay_active:${blocking}:${Math.round((deadline - Date.now()) / 1000)}s_remaining`);
    }
    await page.waitForTimeout(POLL_MS);
  }

  const stillBlocking = (await findVisibleOverlay(page)) ?? "unknown";
  throw new Error(
    `login_timeout:180s 后仍被 "${stillBlocking}" 遮挡，请重新运行 pnpm monitor；` +
      `若出现新弹窗类型请将 selector 加入 BLOCKING_OVERLAY_SELECTORS`,
  );
}

export async function openDouyinInbox(options: MonitorOptions): Promise<{ page: Page; close: () => Promise<void> }> {
  const context = await chromium.launchPersistentContext(options.userDataDir, {
    headless: options.headless,
    args: browserLaunchArgs(options),
  });
  const page = context.pages()[0] ?? (await context.newPage());
  await hideBrowserIfRequested(page, options);
  await page.goto(options.inboxUrl, { waitUntil: "domcontentloaded" });
  await hideBrowserIfRequested(page, options);
  console.log("login_wait_start");
  await waitForLoginIfNeeded(page);
  console.log("login_wait_done:proceeding_to_click");

  if (options.openMessageText) {
    await page.locator(visibleTextSelector(options.openMessageText)).last().click({ timeout: 10000 });
    const opened = await waitForConversationList(page);
    if (!opened) {
      await page.locator(visibleTextSelector(options.openMessageText)).last().click({ timeout: 10000 });
      const openedAfterRetry = await waitForConversationList(page, 5000);
      if (!openedAfterRetry) {
        console.warn("open_message_warning:conversation_list_not_found");
      }
    }
  }

  if (options.openChatText) {
    try {
      const clicked = await clickConversationByText(page, options.openChatText);
      if (clicked) {
        await page.waitForTimeout(2000);
      } else {
        console.warn(`open_chat_warning:not_found:${options.openChatText}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message.split("\n")[0] : "unknown";
      console.warn(`open_chat_warning:${message}`);
    }
  }

  return {
    page,
    close: async () => {
      await context.close();
    },
  };
}
