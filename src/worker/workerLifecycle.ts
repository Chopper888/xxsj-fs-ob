import { isProductionQueuePlatform } from "../platform/platformDeclaration.js";
import { readTaskRetryCount } from "./autoWorker.js";

export interface BaseQueueRecord {
  record_id: string;
  fields: Record<string, unknown>;
}

const MAX_RETRIES = 3;
const RETRY_BACKOFF_MS = [60_000, 300_000, 900_000] as const;
const RECOVERABLE_ERROR = /(timeout|timed out|network|temporar|rate.?limit|qwen|deepseek|base_(write|read)|lark_(timeout|exec)|download_(timeout|failed)|terminated)/i;
const TERMINAL_ERROR = /(unsupported|media_target_id_missing|record_id_|invalid.*(url|format)|not.?found|article_deleted|content_(empty|invalid)|permission|auth|verification|required|access_restricted|existing_note_modified)/i;

export function getRetryBackoffMs(retryCount: number): number {
  return RETRY_BACKOFF_MS[Math.min(Math.max(0, retryCount), RETRY_BACKOFF_MS.length - 1)];
}

function timestampOf(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

export function isRetryEligible(fields: Record<string, unknown>, retryCount: number, now = new Date()): boolean {
  if (String(fields["处理状态"] ?? "") !== "failed") return false;
  if (!isProductionQueuePlatform(fields["来源平台"])) return false;
  if (!Number.isFinite(retryCount) || retryCount >= MAX_RETRIES) return false;
  const error = String(fields["最近错误"] ?? "");
  if (!error || TERMINAL_ERROR.test(error) || !RECOVERABLE_ERROR.test(error)) return false;
  const failedAt = timestampOf(fields["处理时间"]);
  return failedAt === null || now.getTime() - failedAt >= getRetryBackoffMs(retryCount);
}

// 认领时写入飞书的字段；「重试次数」不再落表，由调用方在认领前调 bumpTaskRetryCount 维护本地计数。
export function prepareAttemptFields(): Record<string, unknown> {
  return {
    "处理状态": "processing",
    "最近错误": "",
    "处理时间": Date.now(),
  };
}

function stableTime(record: BaseQueueRecord, index: number): number {
  return timestampOf(record.fields["收录日期"])
    ?? timestampOf(record.fields["作品发布日期"])
    ?? timestampOf(record.fields["处理时间"])
    ?? index;
}

export async function selectRunnableRecordIds(
  dataRoot: string,
  records: BaseQueueRecord[],
  limit: number,
  now = new Date(),
  retryCounts?: Map<string, number>,
): Promise<string[]> {
  const failedRecords = records.filter((record) => String(record.fields["处理状态"] ?? "") === "failed");
  if (!retryCounts && failedRecords.length) {
    retryCounts = new Map();
    await Promise.all(failedRecords.map(async (record) => {
      retryCounts!.set(record.record_id, await readTaskRetryCount(dataRoot, record.record_id));
    }));
  }
  const prioritized = records.map((record, index) => ({ record, index }))
    .filter(({ record }) => isProductionQueuePlatform(record.fields["来源平台"]))
    .filter(({ record }) => {
      const status = String(record.fields["处理状态"] ?? "");
      return status === "pending" || status === "draft_ready" || isRetryEligible(record.fields, retryCounts?.get(record.record_id) ?? 0, now);
    })
    .sort((a, b) => {
      const rank = (record: BaseQueueRecord) => {
        const status = String(record.fields["处理状态"] ?? "");
        return status === "pending" ? 0 : status === "draft_ready" ? 1 : 2;
      };
      return rank(a.record) - rank(b.record) || stableTime(a.record, a.index) - stableTime(b.record, b.index) || a.index - b.index;
    });
  return prioritized
    .map(({ record }) => record)
    .map((record) => record.record_id)
    .filter(Boolean)
    .slice(0, Math.max(0, limit));
}

export function shouldContinuePolling(state: {
  runOnce: boolean;
  stopRequested: boolean;
}): boolean {
  return !state.runOnce && !state.stopRequested;
}
