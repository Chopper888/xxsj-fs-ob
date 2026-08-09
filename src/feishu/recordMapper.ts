import { canonicalDouyinVideoUrl } from "../domain/dedupe.js";
import type { CaptureRecord } from "../domain/types.js";

function formatFeishuDate(iso: string): string {
  return iso.replace("T", " ").replace(/\.\d{3}Z$/, "");
}

export function mapRecordToFeishuFields(record: CaptureRecord): Record<string, string> {
  return {
    "标题": record.title,
    "内容类型": record.type,
    "原始链接": canonicalDouyinVideoUrl(record.url) ?? "",
    "原始文本": record.text,
    "作者/来源": record.author ?? "",
    "摘要": record.summary?.summary ?? "",
    "捕获时间": formatFeishuDate(record.capturedAt),
    "处理状态": record.status,
    "去重 ID": record.dedupeId,
    "错误信息": record.errorMessage ?? "",
    "知识库链接": record.knowledgeBaseUrl ?? "",
  };
}
