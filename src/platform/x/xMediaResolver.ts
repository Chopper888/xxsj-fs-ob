import type { NormalizedMedia } from "../types.js";
import { selectVideoStream } from "./xVideoResolver.js";

export interface XMediaResolverInput { postId: string; text: string; logger?: { warn(message: string): void } }
export interface XMediaResolverOptions { fetchImpl?: typeof fetch; baseUrl?: string }

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const DEFAULT_BASE_URL = "https://cdn.syndication.twimg.com/tweet-result";

// oEmbed HTML 不暴露 <img>，图片只以 pic.twitter.com/XXX 短链出现在正文。
// 走公开 syndication 接口（X 网页嵌入组件数据源，无需 cookie/登录态）拿完整媒体列表。
export async function resolveXTweetMedia(input: XMediaResolverInput, options: XMediaResolverOptions = {}): Promise<NormalizedMedia[]> {
  if (!/pic\.twitter\.com/i.test(input.text)) return [];
  const fetchImpl = options.fetchImpl ?? fetch;
  const baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
  let response: Response;
  try {
    response = await fetchImpl(`${baseUrl}?id=${encodeURIComponent(input.postId)}&lang=en&token=${encodeURIComponent(input.postId)}`, {
      headers: { "User-Agent": UA },
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    input.logger?.warn?.(`x_media_resolve_network:${String(error)}`);
    return [];
  }
  if (!response.ok) {
    input.logger?.warn?.(`x_media_resolve_http:${response.status}`);
    return [];
  }
  let json: { mediaDetails?: Array<{ type?: string; media_url_https?: string }> };
  try {
    json = (await response.json()) as typeof json;
  } catch {
    return [];
  }
  const details = Array.isArray(json?.mediaDetails) ? json.mediaDetails : [];
  const media: NormalizedMedia[] = details
    .filter(m => m.type === "photo" && typeof m.media_url_https === "string")
    .map((m, i) => ({ kind: "image", role: "context", sourceUrl: m.media_url_https as string, order: i + 1 }));
  const stream = selectVideoStream(json);
  if (stream) media.push({ kind: "video", role: "primary", sourceUrl: stream.url, mimeType: stream.mimeType });
  return media;
}
