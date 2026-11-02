import type { ContentAnalysisResult } from "../../analysis/contentAnalysis.js";
import type { NormalizedContent, PreparedContent } from "../types.js";

const y = (v: unknown) => JSON.stringify(v ?? "");

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}

export interface YouTubeMarkdownInput {
  recordId: string;
  content: NormalizedContent;
  prepared: PreparedContent;
  analysis: ContentAnalysisResult;
  processedAt: string;
}

export function buildYouTubeMarkdown(input: YouTubeMarkdownInput): string {
  const { content, prepared, analysis } = input;
  const label = prepared.preparationMode === "subtitle-first" ? "官方字幕" : "ASR 转写";
  const title = content.title ?? "未命名 YouTube 视频";
  const duration = formatDuration(Number(content.sourceMetadata?.durationSeconds));
  const lines = [
    "---",
    "platform: YouTube",
    `author: ${y(content.author?.name)}`,
    `title: ${y(title)}`,
    `published_at: ${y(content.publishedAt)}`,
    `source_url: ${y(content.identity.canonicalUrl)}`,
    `video_id: ${y(content.identity.platformContentId)}`,
    `base_record_id: ${y(input.recordId)}`,
    `duration: ${y(duration)}`,
    `processed_at: ${y(input.processedAt)}`,
    "---",
    "",
    `# ${title}`,
    "",
    "## AI 摘要",
    "",
    analysis.summary,
    "",
    "## AI 关键信息",
    "",
    ...analysis.key_points.map((x) => `- ${x}`),
    "",
    `## ${label}`,
    "",
    prepared.primaryText,
    "",
    `> 转录来源：${label}`,
    `> 原始链接：${content.identity.canonicalUrl}`,
    `> 内容准备模式：${prepared.preparationMode}`,
    "",
  ];
  return lines.join("\n");
}
