import { PlatformAdapterError } from "../platformAdapter.js";
import type { PlatformIdentity } from "../types.js";

const YOUTUBE_HOSTS = ["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be"];
const VIDEO_ID_RE = /^[\w-]{11}$/;

export function parseYouTubeUrl(input: string): { videoId: string } {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new PlatformAdapterError("invalid_url");
  }
  const host = url.hostname.toLowerCase();
  if (!YOUTUBE_HOSTS.includes(host)) throw new PlatformAdapterError("invalid_url");
  if (host === "youtu.be") {
    const id = url.pathname.replace(/^\/+/, "").split("/")[0];
    if (!VIDEO_ID_RE.test(id)) throw new PlatformAdapterError("invalid_url");
    return { videoId: id };
  }
  if (url.pathname === "/watch" || url.pathname === "/watch/") {
    const id = url.searchParams.get("v") ?? "";
    if (!VIDEO_ID_RE.test(id)) throw new PlatformAdapterError("invalid_url");
    return { videoId: id };
  }
  throw new PlatformAdapterError("invalid_url");
}

export function isYouTubeUrl(input: string): boolean {
  try {
    parseYouTubeUrl(input);
    return true;
  } catch {
    return false;
  }
}

export function buildYouTubeIdentity(sourceUrl: string): PlatformIdentity {
  const { videoId } = parseYouTubeUrl(sourceUrl);
  return {
    platform: "youtube",
    platformContentId: videoId,
    sourceUrl,
    canonicalUrl: `https://www.youtube.com/watch?v=${videoId}`,
    dedupeKey: `youtube:${videoId}`,
  };
}
