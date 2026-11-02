import { PlatformAdapterError } from "../platformAdapter.js";
import type { PlatformIdentity } from "../types.js";

const X_HOSTS = ["x.com", "www.x.com", "twitter.com", "www.twitter.com"];
const TCO_HOST = "t.co";
const BARE_ID = /^\d{1,20}$/;
const MAX_REDIRECTS = 10;

export function parseXUrl(input: string): { handle: string; postId: string } {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    const bare = input.trim();
    if (BARE_ID.test(bare)) url = new URL(`https://x.com/i/status/${bare}`);
    else throw new PlatformAdapterError("invalid_url");
  }
  if (!X_HOSTS.includes(url.hostname.toLowerCase())) throw new PlatformAdapterError("invalid_url");
  const m = url.pathname.match(/^\/([^/]+)\/status\/(\d+)/);
  if (!m) throw new PlatformAdapterError("invalid_url");
  return { handle: m[1], postId: m[2] };
}

export function isXTcoShortLink(input: string): boolean {
  let url: URL;
  try { url = new URL(input); } catch { return false; }
  return url.hostname.toLowerCase() === TCO_HOST;
}

export async function resolveXTcoShortLink(input: string, fetcher: typeof fetch = fetch): Promise<string> {
  if (!isXTcoShortLink(input)) return input;
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

export function isXPostUrl(input: string): boolean {
  if (isXTcoShortLink(input)) return true;
  try { parseXUrl(input); return true; } catch { return false; }
}

export function buildXIdentity(sourceUrl: string): PlatformIdentity {
  const { handle, postId } = parseXUrl(sourceUrl);
  return { platform: "x", platformContentId: postId, sourceUrl, canonicalUrl: `https://x.com/${handle}/status/${postId}`, dedupeKey: `x:${postId}` };
}
