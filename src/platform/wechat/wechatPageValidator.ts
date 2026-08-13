import { PlatformAdapterError, type PlatformAdapterErrorCode } from "../platformAdapter.js";
import { isWechatArticleUrl } from "./wechatUrl.js";
import type { WechatPageSnapshot } from "./wechatTypes.js";
export class WechatArticleError extends PlatformAdapterError { constructor(code: PlatformAdapterErrorCode) { super(code); } }
export function validateWechatArticlePage(page: WechatPageSnapshot): { valid: true } {
  const text = `${page.title}\n${page.pageText}`.toLowerCase();
  if (!isWechatArticleUrl(page.url)) throw new WechatArticleError("unsupported_wechat_url");
  if (/验证码|完成验证|滑块|环境异常|security verification/.test(text)) throw new WechatArticleError("verification_required");
  if (/登录后|请登录|log in/.test(text)) throw new WechatArticleError("auth_required");
  if (/页面不存在|内容不存在|article not found/.test(text)) throw new WechatArticleError("article_not_found");
  if (/已被.*删除|内容已删除|deleted by/.test(text)) throw new WechatArticleError("article_deleted");
  if (/访问过于频繁|操作频繁|请求过于频繁/.test(text)) throw new WechatArticleError("rate_limited");
  if (/访问受限|无法访问|停止访问/.test(text)) throw new WechatArticleError("access_restricted");
  if (!page.bodyText?.trim() || page.bodyText.trim().length < 20) throw new WechatArticleError("content_empty");
  if (!page.title?.trim() || !page.account?.trim()) throw new WechatArticleError("content_invalid");
  return { valid: true };
}
