import { isProductionQueuePlatform } from "../platform/platformDeclaration.js";

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

export function isRetryEligible(fields: Record<string, unknown>, now = new Date()): boolean {
  if (String(fields["处理状态"] ?? "") !== "failed") return false;
  if (!isProductionQueuePlatform(fields["来源平台"])) return false;
  const retryCount = Number(fields["重试次数"] ?? 0);
  if (!Number.isFinite(retryCount) || retryCount >= MAX_RETRIES) return false;
  const error = String(fields["最近错误"] ?? "");
  if (!error || TERMINAL_ERROR.test(error) || !RECOVERABLE_ERROR.test(error)) return false;
  const failedAt = timestampOf(fields["处理时间"]);
  return failedAt === null || now.getTime() - failedAt >= getRetryBackoffMs(retryCount);
}

export function prepareAttemptFields(fields: Record<string, unknown>): Record<string, unknown> {
  const retryCount = Number(fields["重试次数"] ?? 0);
  return {
    "处理状态": "processing",
    "重试次数": String(fields["处理状态"] ?? "") === "failed" ? retryCount + 1 : retryCount,
    "最近错误": "",
    "处理时间": Date.now(),
  };
}

function stableTime(record: BaseQueueRecord, index: number): number {
  return timestampOf(record.fields["收藏时间"])
    ?? timestampOf(record.fields["日期"])
    ?? timestampOf(record.fields["处理时间"])
    ?? index;
}

export function selectRunnableRecordIds(
  records: BaseQueueRecord[],
  limit: number,
  now = new Date(),
): string[] {
  const prioritized = records.map((record, index) => ({ record, index }))
    .filter(({ record }) => isProductionQueuePlatform(record.fields["来源平台"]))
    .filter(({ record }) => {
      const status = String(record.fields["处理状态"] ?? "");
      return status === "pending" || status === "draft_ready" || isRetryEligible(record.fields, now);
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
