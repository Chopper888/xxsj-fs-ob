import { createHash } from "node:crypto";
import type { PlatformIdentity } from "../types.js";

const TRACKING = new Set(["scene", "subscene", "clicktime", "enterid", "sessionid", "ascene", "fasttmpl_type", "fasttmpl_fullversion", "fasttmpl_flag", "devicetype", "version", "nettype", "exportkey", "pass_ticket", "wx_header"]);
export function isWechatArticleUrl(raw: string): boolean {
  try { const u = new URL(raw); return u.hostname.toLowerCase() === "mp.weixin.qq.com" && (u.pathname === "/s" || u.pathname.startsWith("/s/")); } catch { return false; }
}
export function normalizeWechatArticleUrl(raw: string): string {
  let u: URL; try { u = new URL(raw); } catch { throw new Error("unsupported_wechat_url"); }
  if (!isWechatArticleUrl(raw)) throw new Error("unsupported_wechat_url");
  u.protocol = "https:"; u.hostname = "mp.weixin.qq.com"; u.hash = "";
  for (const key of [...u.searchParams.keys()]) if (TRACKING.has(key)) u.searchParams.delete(key);
  u.searchParams.sort(); return u.toString();
}
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
export function buildWechatIdentity(raw: string): PlatformIdentity {
  const canonicalUrl = normalizeWechatArticleUrl(raw); const u = new URL(canonicalUrl);
  const tuple = [u.searchParams.get("__biz"), u.searchParams.get("mid"), u.searchParams.get("idx")];
  const stable = tuple.every(Boolean) ? tuple.join(":") : `sha256:${hash(canonicalUrl)}`;
  const identityBasis = tuple.every(Boolean) ? tuple.join("|") : canonicalUrl;
  return { platform: "wechat_official_account", platformContentId: stable, sourceUrl: raw, canonicalUrl, dedupeKey: `wechat:${hash(identityBasis)}` };
}

