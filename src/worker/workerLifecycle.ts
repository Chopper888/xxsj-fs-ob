export interface BaseQueueRecord {
  record_id: string;
  fields: Record<string, unknown>;
}

export function selectRunnableRecordIds(
  records: BaseQueueRecord[],
  limit: number,
): string[] {
  return records
    .filter((record) => {
      const status = String(record.fields["处理状态"] ?? "");
      const retryCount = Number(record.fields["重试次数"] ?? 0);
      return status === "pending" || status === "draft_ready" ||
        (status === "failed" && retryCount < 3);
    })
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
