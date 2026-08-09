import { canonicalDouyinVideoUrl } from "./dedupe.js";
import type { CapturedItem, ContentType, MessageSnapshot } from "./types.js";

function cleanText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeShareTitle(line: string): string {
  return line
    .replace(/^[^:：]{1,40}[:：]\s*/, "")
    .replace(/^.*?分享\s*\[\s*(视频|链接|图文|图片)\s*\]\s*[:：]?\s*/, "")
    .trim();
}

function firstMeaningfulLine(text: string): string | undefined {
  const lines = text
    .split(/\n+/)
    .map((line) => cleanText(line))
    .filter(Boolean)
    .filter((line) => !line.includes("分享了一个视频"));

  const titles = lines.map(normalizeShareTitle).filter(Boolean);
  return titles.at(-1) ?? lines.at(-1) ?? lines[0];
}

function firstUrl(snapshot: MessageSnapshot): string | undefined {
  const url = snapshot.links.find((link) => link.includes("douyin.com")) ?? snapshot.links[0];
  return url?.includes("douyin.com") ? canonicalDouyinVideoUrl(url) : url;
}

function classify(snapshot: MessageSnapshot, url: string | undefined): ContentType {
  const text = cleanText(snapshot.text);
  if (
    url?.includes("/video/") ||
    url?.includes("modal_id=") ||
    text.includes("分享了一个视频") ||
    /分享\s*\[\s*视频\s*\]/.test(text) ||
    snapshot.html.includes("MessageItemShareAwemecontainer")
  ) {
    return "video";
  }
  if (/分享\s*\[\s*链接\s*\]/.test(text)) return "link";
  if (snapshot.images.length > 0 && text.length > 0) return "image_text";
  if (url) return "link";
  if (text.length > 0) return "text";
  return "unknown";
}

function extractAuthor(text: string): string | undefined {
  const firstLine = text
    .split(/\n+/)
    .map((line) => cleanText(line))
    .find(Boolean);
  if (!firstLine) return undefined;

  const match = firstLine.match(/^([^:：]{1,40})[:：]/);
  return match?.[1]?.trim();
}

function stripHtml(value: string): string {
  return value
    .replace(/<script\b[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ");
}

function extractShareCardAuthorFromHtml(html: string): string | undefined {
  const authorClassPattern = /<([a-z0-9]+)\b[^>]*class=["'][^"']*(?:AwemeautorName|AwemeauthorName|autorName|authorName)[^"']*["'][^>]*>([\s\S]*?)<\/\1>/gi;
  for (const match of html.matchAll(authorClassPattern)) {
    const value = cleanText(stripHtml(match[2] ?? ""));
    if (value) return value.replace(/^@/, "");
  }
  return undefined;
}

function isLikelyStandaloneAuthor(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= 40 &&
    !value.includes("分享") &&
    !value.includes("#") &&
    !/^https?:\/\//i.test(value)
  );
}

function extractShareCardAuthor(snapshot: MessageSnapshot): string | undefined {
  if (!snapshot.html.includes("MessageItemShareAwemecontainer")) return undefined;

  const htmlAuthor = extractShareCardAuthorFromHtml(snapshot.html);
  if (htmlAuthor) return htmlAuthor;

  const lines = snapshot.text
    .split(/\n+/)
    .map((line) => cleanText(line).replace(/^@/, ""))
    .filter(Boolean);

  if (lines.length === 1 && isLikelyStandaloneAuthor(lines[0])) {
    return lines[0];
  }

  return undefined;
}

function fallbackVideoShareTitle(author: string | undefined): string {
  return author ? `${author} 分享的视频` : "抖音视频";
}

function isGenericDouyinTitle(value: string): boolean {
  return (
    value.includes("海量优质视频内容") ||
    value.includes("你想要的好内容，都在抖音精选") ||
    value.includes("系列合集内容连续看")
  );
}

export function extractCapturedItem(snapshot: MessageSnapshot): CapturedItem {
  const url = firstUrl(snapshot);
  const type = classify(snapshot, url);
  const text = cleanText(snapshot.text);
  const explicitTitle = cleanText(snapshot.title ?? "");
  const author = extractAuthor(snapshot.text) ?? (type === "video" ? extractShareCardAuthor(snapshot) : undefined);
  const isShareCard = snapshot.html.includes("MessageItemShareAwemecontainer");
  const isShareCardAuthorOnly = Boolean(
    author && isShareCard && text.replace(/^@/, "") === author,
  );
  const safeExplicitTitle = type === "video" && isGenericDouyinTitle(explicitTitle) ? "" : explicitTitle;
  let title =
    safeExplicitTitle ||
    (type === "video" && isShareCard ? fallbackVideoShareTitle(author) : firstMeaningfulLine(snapshot.text)) ||
    (url ? "链接内容" : "未识别内容");

  if (
    /^([^:：]{1,40}[:：]\s*)?分享\s*\[\s*视频\s*\]\s*$/.test(title) ||
    (/分享\s*\[\s*视频\s*\]/.test(text) && !/分享\s*\[\s*视频\s*\]\s*[:：]\s*\S+/.test(text))
  ) {
    title = "分享视频";
  }
  if (/^([^:：]{1,40}[:：]\s*)?分享\s*\[\s*链接\s*\]\s*$/.test(title)) {
    title = "分享链接";
  }

  return {
    type,
    title,
    url,
    text: isShareCardAuthorOnly ? "" : text,
    author,
    timestamp: snapshot.timestamp,
    rawSnapshot: JSON.stringify({
      snapshotId: snapshot.snapshotId,
      title: snapshot.title,
      text: snapshot.text,
      html: snapshot.html.slice(0, 5000),
      links: snapshot.links,
      images: snapshot.images,
      timestamp: snapshot.timestamp,
    }),
  };
}
