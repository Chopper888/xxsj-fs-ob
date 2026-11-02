import { createHash } from "node:crypto";
import { PlatformAdapterError } from "../platformAdapter.js";
import type { PlatformIdentity } from "../types.js";

const BV = /^BV[0-9A-Za-z]{10}$/i;
const AV = /^av(\d{1,12})$/i;
const SHORT_LINK_HOSTS = ["b23.tv", "bili2233.cn"];
const BILI_DOMAIN = /(^|\.)bilibili\.com$/i;
const MAX_REDIRECTS = 10;

export type BilibiliVideoRef = { kind: "bv"; bvid: string } | { kind: "av"; aid: number };

function bilibiliHost(url: URL): void {
  if (!BILI_DOMAIN.test(url.hostname)) throw new PlatformAdapterError("invalid_url");
}

export function extractBvid(input: string): string {
  let url: URL;
  try { url = new URL(input); } catch { throw new PlatformAdapterError("invalid_url"); }
  bilibiliHost(url);
  const part = url.pathname.split("/").find((segment) => BV.test(segment));
  if (!part) throw new PlatformAdapterError("invalid_url");
  return `BV${part.slice(2)}`;
}

export function extractAid(input: string): number {
  let url: URL;
  try { url = new URL(input); } catch { throw new PlatformAdapterError("invalid_url"); }
  bilibiliHost(url);
  const part = url.pathname.split("/").find((segment) => AV.test(segment));
  if (!part) throw new PlatformAdapterError("invalid_url");
  return Number(part.slice(2));
}

export function parseBilibiliVideoRef(input: string): BilibiliVideoRef {
  try {
    return { kind: "bv", bvid: extractBvid(input) };
  } catch {
    return { kind: "av", aid: extractAid(input) };
  }
}

export function isBilibiliShortLink(input: string): boolean {
  let url: URL;
  try { url = new URL(input); } catch { return false; }
  return SHORT_LINK_HOSTS.some((host) => url.hostname.toLowerCase() === host);
}

export function isBilibiliVideoUrl(input: string): boolean {
  if (isBilibiliShortLink(input)) return true;
  try { parseBilibiliVideoRef(input); return true; } catch { return false; }
}

export async function resolveBilibiliShortLink(input: string, fetcher: typeof fetch = fetch): Promise<string> {
  if (!isBilibiliShortLink(input)) return input;
  let url = input;
  for (let i = 0; i < MAX_REDIRECTS; i++) {
    let response: Response;
    try {
      response = await fetcher(url, {
        method: "GET",
        redirect: "manual",
        headers: { "User-Agent": "Mozilla/5.0" },
        signal: AbortSignal.timeout(15000),
      });
    } catch (error) {
      throw new PlatformAdapterError("temporary_network", String(error));
    }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new PlatformAdapterError("invalid_url", "short_link_no_location");
      url = new URL(location, url).toString();
      continue;
    }
    break;
  }
  return url;
}

export function bilibiliRefFromContentId(id: string): BilibiliVideoRef {
  if (/^BV[0-9A-Za-z]{10}$/i.test(id)) return { kind: "bv", bvid: id };
  return { kind: "av", aid: Number(id) };
}

export function buildBilibiliIdentity(sourceUrl: string): PlatformIdentity {
  const ref = parseBilibiliVideoRef(sourceUrl);
  if (ref.kind === "bv") {
    const canonicalUrl = `https://www.bilibili.com/video/${ref.bvid}/`;
    return { platform: "bilibili", platformContentId: ref.bvid, sourceUrl, canonicalUrl, dedupeKey: `bilibili:${ref.bvid}`, dedupeAliases: [`bilibili:${createHash("sha256").update(canonicalUrl).digest("hex")}`] };
  }
  const canonicalUrl = `https://www.bilibili.com/video/av${ref.aid}/`;
  return { platform: "bilibili", platformContentId: String(ref.aid), sourceUrl, canonicalUrl, dedupeKey: `bilibili:av${ref.aid}`, dedupeAliases: [`bilibili:${createHash("sha256").update(canonicalUrl).digest("hex")}`] };
}
