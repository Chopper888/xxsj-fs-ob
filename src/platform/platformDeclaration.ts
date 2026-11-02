import type { PlatformId } from "./types.js";

const PLATFORM_DECLARATION_ALIASES: Readonly<Record<string, PlatformId>> = Object.freeze({
  "抖音": "douyin",
  "公众号": "wechat_official_account",
  "微信公众号": "wechat_official_account",
  "B站": "bilibili",
  "X": "x",
  "Twitter": "x",
  "推特": "x",
  "YouTube": "youtube",
  "Youtube": "youtube",
  "油管": "youtube",
});

export function normalizePlatformDeclaration(value: unknown): PlatformId | undefined {
  return PLATFORM_DECLARATION_ALIASES[String(value ?? "").trim()];
}

export function isProductionQueuePlatform(value: unknown): boolean {
  const platform = normalizePlatformDeclaration(value);
  return platform === "douyin" || platform === "wechat_official_account" || platform === "bilibili" || platform === "x" || platform === "youtube";
}
