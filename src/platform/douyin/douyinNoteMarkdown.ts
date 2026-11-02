import type { ContentAnalysisResult } from "../../analysis/contentAnalysis.js";
import type { NormalizedContent } from "../types.js";
import type { WechatLocalAsset } from "../wechat/wechatAssetMaterializer.js";

const y = (v: unknown) => JSON.stringify(v ?? "");

export interface DouyinNoteMarkdownInput { recordId: string; content: NormalizedContent; analysis: ContentAnalysisResult; assets: WechatLocalAsset[]; warnings: string[]; processedAt: string }

export function buildDouyinNoteMarkdown(input: DouyinNoteMarkdownInput): string {
  const c = input.content, a = input.analysis;
  const text = c.texts.find(x => x.role === "primary")?.text ?? "";
  const images = input.assets.length
    ? input.assets.map(x => `![${x.alt ?? `图片 ${x.order}`}](${x.markdownPath.replace(/\\/g, "/")})\n\n> 原始图片链接：${x.sourceUrl}`).join("\n\n")
    : "";
  return ["---",
    "platform: 抖音",
    `author: ${y(c.author?.name)}`,
    `published_at: ${y(c.publishedAt)}`,
    `source_url: ${y(c.identity.canonicalUrl)}`,
    `note_id: ${y(c.identity.platformContentId)}`,
    `base_record_id: ${y(input.recordId)}`,
    `image_source_urls: ${y(input.assets.map(x => x.sourceUrl))}`,
    `processed_at: ${y(input.processedAt)}`,
    "---", "",
    `# ${c.title ?? "抖音图文"}`,
    "", "## AI 摘要", "", a.summary, "",
    "## AI 关键信息", "", ...a.key_points.map(x => `- ${x}`), "",
    "## 图文配文", "", text, "",
    ...(images ? ["## 原文图片", "", images, ""] : []),
    ...(input.warnings.length ? ["## 采集警告", "", ...input.warnings.map(x => `- ${x}`), ""] : []),
    `> 原始链接：${c.identity.canonicalUrl}`, "",
  ].join("\n");
}
