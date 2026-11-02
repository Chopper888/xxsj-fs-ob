import type { ContentAnalysisResult } from "../../analysis/contentAnalysis.js";
import type { NormalizedContent } from "../types.js";
import type { WechatLocalAsset } from "./wechatAssetMaterializer.js";

export interface WechatMarkdownInput { recordId: string; content: NormalizedContent; analysis: ContentAnalysisResult; assets: WechatLocalAsset[]; warnings: string[]; processedAt: string }
function yaml(value: string | undefined): string { return JSON.stringify(value ?? ""); }
export function buildWechatArticleMarkdown(input: WechatMarkdownInput): string {
  const { content, analysis } = input; const body = content.texts.find(x => x.role === "primary")?.text ?? "";
  const images = input.assets.length ? input.assets.map(x => `![${x.alt ?? `图片 ${x.order}`}](${x.markdownPath.replace(/\\/g, "/")})`).join("\n\n") : "";
  return ["---", "platform: 公众号", `account: ${yaml(content.author?.name)}`, `published_at: ${yaml(content.publishedAt)}`, `source_url: ${yaml(content.identity.canonicalUrl)}`, `work_id: ${yaml(content.identity.platformContentId)}`, `base_record_id: ${yaml(input.recordId)}`, `processed_at: ${yaml(input.processedAt)}`, `primary_category: ${yaml(analysis.primary_category)}`, `secondary_category: ${yaml(analysis.secondary_category)}`, "---", "", `# ${content.title ?? "未命名公众号文章"}`, "", "## AI 摘要", "", analysis.summary, "", "## AI 关键信息", "", ...analysis.key_points.map(x => `- ${x}`), "", "## 原文正文", "", body, "", ...(images ? ["## 原文图片", "", images, ""] : []), ...(input.warnings.length ? ["## 采集警告", "", ...input.warnings.map(x => `- ${x}`), ""] : []), `> 原文来源：${content.identity.canonicalUrl}`, ""].join("\n");
}

