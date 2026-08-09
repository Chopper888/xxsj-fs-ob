import { createDedupeId } from "../domain/dedupe.js";
import { extractCapturedItem } from "../domain/extractor.js";
import type { CaptureRecord, MessageSnapshot } from "../domain/types.js";
import type { LarkCliFeishuWriter } from "../feishu/larkCliWriter.js";
import { mapRecordToFeishuFields } from "../feishu/recordMapper.js";
import type { LocalStateStore } from "../state/localState.js";
import { summarizeCapturedItem, type SummaryClient } from "../summary/summarizer.js";

export type ProcessResultStatus = "written" | "queued" | "duplicate" | "duplicate_status_updated";

export interface ProcessResult {
  status: ProcessResultStatus;
  dedupeId: string;
  record?: CaptureRecord;
}

interface ProcessSnapshotDeps {
  state: LocalStateStore;
  writer: Pick<LarkCliFeishuWriter, "writeFields">;
  summarizer: SummaryClient;
}

function statusFor(record: CaptureRecord): CaptureRecord["status"] {
  if (record.type === "video") return "pending_deep_processing";
  if (record.type === "unknown") return "needs_manual_review";
  if (record.summary) return "summarized";
  return "recorded";
}

async function updateDuplicateStatus(dedupeId: string, deps: ProcessSnapshotDeps): Promise<ProcessResultStatus> {
  try {
    await deps.writer.writeFields(
      { "处理状态": "ignored" },
      {
        recordId: await deps.state.getProcessedRecordId(dedupeId),
        lookupDedupeId: dedupeId,
        createIfMissing: false,
      },
    );
    return "duplicate_status_updated";
  } catch {
    return "duplicate";
  }
}

export async function processSnapshot(snapshot: MessageSnapshot, deps: ProcessSnapshotDeps): Promise<ProcessResult> {
  const item = extractCapturedItem(snapshot);
  const dedupeId = createDedupeId({
    url: item.url,
    text: item.text,
    rawSnapshot: item.rawSnapshot,
  });

  if (await deps.state.isProcessed(dedupeId)) {
    return { status: await updateDuplicateStatus(dedupeId, deps), dedupeId };
  }

  let record: CaptureRecord = {
    ...item,
    dedupeId,
    capturedAt: new Date().toISOString(),
    status: "recorded",
  };

  const summary = item.type === "video" ? undefined : await summarizeCapturedItem(item, deps.summarizer);
  record = {
    ...record,
    summary,
    status: statusFor({ ...record, summary }),
  };

  const fields = mapRecordToFeishuFields(record);

  try {
    const writeResult = await deps.writer.writeFields(fields, {
      updateFieldsIfExisting: { "处理状态": "ignored" },
    });
    record = {
      ...record,
      feishuRecordId: writeResult?.recordId,
      status: writeResult?.matchedExisting ? "ignored" : record.status,
    };
    await deps.state.markProcessed(dedupeId, writeResult?.recordId);
    return { status: writeResult?.matchedExisting ? "duplicate_status_updated" : "written", dedupeId, record };
  } catch (error) {
    const queuedRecord: CaptureRecord = {
      ...record,
      status: "pending_retry",
      errorMessage: error instanceof Error ? error.message : "unknown_write_error",
    };
    await deps.state.appendPending(queuedRecord);
    await deps.state.markProcessed(dedupeId);
    return { status: "queued", dedupeId, record: queuedRecord };
  }
}
