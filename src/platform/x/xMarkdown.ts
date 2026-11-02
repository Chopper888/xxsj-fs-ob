import type { ContentAnalysisResult } from "../../analysis/contentAnalysis.js";
import type { NormalizedContent } from "../types.js";
import type { WechatLocalAsset } from "../wechat/wechatAssetMaterializer.js";

const y = (v: unknown) => JSON.stringify(v ?? "");

export interface XMarkdownInput { recordId: string; content: NormalizedContent; analysis: ContentAnalysisResult; assets: WechatLocalAsset[]; warnings: string[]; processedAt: string; transcript?: { text: string; provider: string } }

export function buildXMarkdown(input: XMarkdownInput): string {
  const c = input.content, a = input.analysis, m = c.sourceMetadata ?? {};
  const text = c.texts.find(x => x.role === "primary")?.text ?? "";
  const images = input.assets.length
    ? input.assets.map(x => `![${x.alt ?? `图片 ${x.order}`}](${x.markdownPath.replace(/\\/g, "/")})\n\n> 原始图片链接：${x.sourceUrl}`).join("\n\n")
    : "";
  const transcript = input.transcript
    ? [input.transcript.text, "", `> 逐字稿来源：${input.transcript.provider} 可读化结果，未经人工校正`, ""]
    : [];
  return ["---", "platform: 推特", `author: ${y(c.author?.name)}`, `handle: ${y(m.handle)}`, `published_at: ${y(c.publishedAt)}`, `source_url: ${y(c.identity.canonicalUrl)}`, `post_id: ${y(c.identity.platformContentId)}`, `base_record_id: ${y(input.recordId)}`, `image_source_urls: ${y(input.assets.map(x => x.sourceUrl))}`, `processed_at: ${y(input.processedAt)}`, "---", "", `# ${c.author?.name ?? "X Post"} 的 Post`, "", "## AI 摘要", "", a.summary, "", "## AI 关键信息", "", ...a.key_points.map(x => `- ${x}`), "", "## 原始 Post 正文", "", text, "", ...(images ? ["## 原文图片", "", images, ""] : []), ...(input.transcript ? ["## 视频逐字稿", "", ...transcript] : []), ...(input.warnings.length ? ["## 采集警告", "", ...input.warnings.map(x => `- ${x}`), ""] : []), ...(!input.assets.length && m.mediaHint ? ["> 原帖包含媒体；公开 oEmbed 未稳定提供结构化媒体文件，请查看原始链接。", ""] : []), ...(m.embedResolvedDifferentPost ? [`> oEmbed 解析到关联原帖 ID：${m.resolvedEmbedPostId}`, ""] : []), `> 原始链接：${c.identity.canonicalUrl}`, ""].join("\n");
}
