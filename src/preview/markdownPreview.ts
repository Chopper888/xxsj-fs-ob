export type DownloadUrlStatus = "available" | "expired" | "unknown";
export type ReviewConfidence = "high" | "medium" | "low";

export interface TranscriptReviewCandidate {
  original: string;
  suggestion: string;
  reason: string;
  confidence: ReviewConfidence;
  evidence: string[];
  approved: boolean;
  review_note: string;
}

export interface MarkdownPreviewInput {
  title: string;
  author: string;
  platform: string;
  originalUrl: string;
  resolvedDownloadUrl: string;
  resolvedAt: string;
  downloadUrlStatus: DownloadUrlStatus;
  localMediaPath: string;
  workId: string;
  publishedAt: string;
  collectedAt: string;
  primaryCategory: string;
  secondaryCategory: string;
  baseRecordId: string;
  dedupeId: string;
  transcriber: string;
  analyzer: string;
  reviewStatus: "needs_review";
  videoSummary: string;
  transcript: string;
  corrections: TranscriptReviewCandidate[];
  processedAt: string;
}

function yamlString(value: string): string {
  return JSON.stringify(value ?? "");
}

export function sanitizeWindowsFileName(value: string): string {
  return value.replace(/[<>:"/\\|?*]/g, "_").replace(/[. ]+$/g, "");
}

export function renderMarkdownPreview(input: MarkdownPreviewInput): string {
  const directLink = input.resolvedDownloadUrl || "无（未取得或已失效）";
  const pending = input.corrections.filter((item) => !item.approved);
  const correctionSection = pending.length
    ? pending.map((item) => [
        `- \`${item.original}\` → \`${item.suggestion}\``,
        `  - 依据：${item.reason}`,
        `  - 置信度：${item.confidence}`,
        `  - 证据来源：${item.evidence.join("、") || "无"}`,
        "  - 状态：未批准",
      ].join("\n")).join("\n")
    : "无";
  return [
    "---",
    `title: ${yamlString(input.title)}`,
    `author: ${yamlString(input.author)}`,
    `platform: ${yamlString(input.platform)}`,
    `original_url: ${yamlString(input.originalUrl)}`,
    `resolved_download_url: ${yamlString(input.resolvedDownloadUrl)}`,
    `resolved_at: ${yamlString(input.resolvedAt)}`,
    `local_media_path: ${yamlString(input.localMediaPath)}`,
    `douyin_work_id: ${yamlString(input.workId)}`,
    `published_at: ${yamlString(input.publishedAt)}`,
    `collected_at: ${yamlString(input.collectedAt)}`,
    `primary_category: ${yamlString(input.primaryCategory)}`,
    `secondary_category: ${yamlString(input.secondaryCategory)}`,
    `base_record_id: ${yamlString(input.baseRecordId)}`,
    `dedupe_id: ${yamlString(input.dedupeId)}`,
    `transcriber: ${yamlString(input.transcriber)}`,
    `analyzer: ${yamlString(input.analyzer)}`,
    `review_status: ${yamlString(input.reviewStatus)}`,
    "---",
    "",
    `# ${input.title}`,
    "",
    `> 作者：${input.author || "未知"}`,
    `> 平台：${input.platform}`,
    `> 发布日期：${input.publishedAt || "未知"}`,
    `> 收藏时间：${input.collectedAt || "未知"}`,
    "",
    `- 原始视频链接：${input.originalUrl}`,
    `- 视频直接下载链接：${directLink}`,
    `- 直接链接解析时间：${input.resolvedAt || "未知"}（该链接可能过期）`,
    `- 本地视频文件：${input.localMediaPath}`,
    "",
    "## 视频提要",
    "",
    input.videoSummary,
    "",
    "## 完整逐字稿",
    "",
    input.transcript,
    "",
    "## 转写待确认",
    "",
    correctionSection,
    "",
    "## 处理信息",
    "",
    `- 转写器：${input.transcriber}`,
    `- 分析模型：${input.analyzer}`,
    `- Base Record ID：${input.baseRecordId}`,
    `- 处理时间：${input.processedAt}`,
    `- 审核状态：${input.reviewStatus}`,
    "",
  ].join("\n");
}
