import { createHash } from "node:crypto";

export interface DedupeInput {
  url?: string;
  text?: string;
  rawSnapshot?: string;
}

const TRACKING_PARAMS = new Set([
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "previous_page",
  "enter_from",
  "share_token",
]);

export function extractAwemeId(value: string | undefined): string | undefined {
  if (!value) return undefined;

  const patterns = [/\/video\/(\d{8,})/, /[?&]modal_id=(\d{8,})/, /[?&]aweme_id=(\d{8,})/];

  for (const pattern of patterns) {
    const match = value.match(pattern);
    if (match?.[1]) return match[1];
  }

  return undefined;
}

export function canonicalDouyinVideoUrl(value: string | undefined): string | undefined {
  const awemeId = extractAwemeId(value);
  if (!awemeId) return value?.trim() || undefined;
  return `https://www.douyin.com/jingxuan?modal_id=${awemeId}`;
}

export function normalizeUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;

  try {
    const url = new URL(value);
    for (const key of [...url.searchParams.keys()]) {
      if (TRACKING_PARAMS.has(key) || key.startsWith("utm_")) {
        url.searchParams.delete(key);
      }
    }
    url.hash = "";
    return url.toString();
  } catch {
    return value.trim() || undefined;
  }
}

export function stableHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function normalizeText(value: string | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

export function createDedupeId(input: DedupeInput): string {
  const awemeId = extractAwemeId(input.url) ?? extractAwemeId(input.text);
  if (awemeId) return `aweme:${awemeId}`;

  const normalizedUrl = normalizeUrl(input.url);
  if (normalizedUrl) return `url:${stableHash(normalizedUrl)}`;

  const text = normalizeText(input.text);
  if (text) return `text:${stableHash(text)}`;

  return `snapshot:${stableHash(input.rawSnapshot ?? "")}`;
}
