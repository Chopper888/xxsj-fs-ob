import { loadConfigFromEnv } from "../config.js";
import { createDedupeId } from "../domain/dedupe.js";
import { extractCapturedItem } from "../domain/extractor.js";
import type { CaptureRecord, MessageSnapshot } from "../domain/types.js";
import { LarkCliFeishuWriter } from "../feishu/larkCliWriter.js";
import {
  collectMessageSnapshots,
  enrichShareCardSnapshot,
  isUnresolvedDouyinShareCard,
  openDouyinInbox,
} from "../monitor/playwrightMonitor.js";
import { processSnapshot, type ProcessResult } from "../pipeline/processSnapshot.js";
import { LocalStateStore } from "../state/localState.js";
import { OpenAICompatibleSummaryClient } from "../summary/openaiCompatibleClient.js";
import { MockSummaryClient } from "../summary/summarizer.js";
import { VideoDeepProcessor } from "../video/videoDeepProcessor.js";
import { transcribeWithFallback } from "../asr/asrOrchestrator.js";
import { buildOrchestratorConfigFromEnv } from "../asr/providers.js";

const config = loadConfigFromEnv();

const state = new LocalStateStore("data");
const writer = new LarkCliFeishuWriter({
  baseToken: config.feishu.baseToken,
  tableId: config.feishu.tableId,
});
const summarizer =
  config.summary.mode === "openai" && config.summary.apiKey
    ? new OpenAICompatibleSummaryClient({
        baseUrl: config.summary.baseUrl,
        apiKey: config.summary.apiKey,
        model: config.summary.model,
    })
    : new MockSummaryClient();

const skippedShareCardWarnings = new Set<string>();
const attemptedProcessedVideoRescues = new Set<string>();

async function markSnapshotProcessed(snapshot: MessageSnapshot): Promise<void> {
  await state.markProcessed(dedupeIdForSnapshot(snapshot));
}

function dedupeIdForSnapshot(snapshot: MessageSnapshot): string {
  const item = extractCapturedItem(snapshot);
  return createDedupeId({
    url: item.url,
    text: item.text,
    rawSnapshot: item.rawSnapshot,
  });
}

function captureRecordFromSnapshot(snapshot: MessageSnapshot): CaptureRecord {
  const item = extractCapturedItem(snapshot);
  return {
    ...item,
    dedupeId: createDedupeId({
      url: item.url,
      text: item.text,
      rawSnapshot: item.rawSnapshot,
    }),
    capturedAt: new Date().toISOString(),
    status: item.type === "video" ? "pending_deep_processing" : "recorded",
  };
}

const { page, close } = await openDouyinInbox({
  inboxUrl: config.douyin.inboxUrl,
  messageSelector: config.douyin.messageSelector,
  openMessageText: config.douyin.openMessageText,
  openChatText: config.douyin.openChatText,
  userDataDir: config.douyin.userDataDir,
  headless: config.douyin.headless,
  offscreen: config.douyin.offscreen,
}).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`startup_failed:${message}`);
  process.exit(1);
});

const videoDeepProcessor = config.video.deepProcessingEnabled
  ? new VideoDeepProcessor({
      rootDir: "data",
      browserContext: page.context(),
      writer,
      summarizer,
      pythonPath: config.video.pythonPath,
      whisperScriptPath: config.video.whisperScriptPath,
      transcriptModel: config.video.transcriptModel,
      transcriptLanguage: config.video.transcriptLanguage,
      transcriptComputeType: config.video.transcriptComputeType,
      hideBrowser: config.douyin.offscreen && !config.douyin.headless,
      asrTranscriber: (() => {
        const asrConfig = buildOrchestratorConfigFromEnv(process.env);
        return (mediaUrl: string, mediaPath: string, outputDir: string) =>
          transcribeWithFallback(asrConfig, mediaUrl, mediaPath, outputDir);
      })(),
      onEvent: (event, job, detail) => {
        if (event === "writeback_done") {
          console.log(`feishu_writeback_success:${job.dedupeId}`);
        }
        console.log(`video_deep_processing_${event}:${job.dedupeId}${detail ? `:${detail}` : ""}`);
      },
    })
  : undefined;

let shouldStop = false;

process.on("SIGINT", () => {
  shouldStop = true;
});
page.on("close", () => {
  console.warn("monitor_main_page_closed");
  shouldStop = true;
});
page.context().on("close", () => {
  console.warn("monitor_browser_context_closed");
  shouldStop = true;
});

console.log("monitor_started");
console.log(`open_or_confirm_inbox:${config.douyin.inboxUrl}`);
console.log(
  `monitor_config:ignore_existing_on_start=${config.douyin.ignoreExistingOnStart}:poll_interval_ms=${config.douyin.pollIntervalMs}:video_deep_processing=${Boolean(videoDeepProcessor)}`,
);

function pumpVideoDeepProcessing(): void {
  if (!videoDeepProcessor) return;
  void videoDeepProcessor.pump().catch((error) => {
    const message = error instanceof Error ? error.message : "unknown";
    console.error(`video_deep_processing_error:${message}`);
  });
}

async function enqueueVideoForDeepProcessing(record: CaptureRecord, logPrefix: string): Promise<void> {
  if (record.type !== "video" || !record.url) return;
  const enqueueStatus = await videoDeepProcessor?.enqueue(record);
  if (enqueueStatus === "enqueued") {
    console.log(`${logPrefix}:${record.dedupeId}`);
    pumpVideoDeepProcessing();
  }
}

async function rescueProcessedVideoWithoutRecordId(snapshot: MessageSnapshot, rawDedupeId: string): Promise<void> {
  if (!videoDeepProcessor || !rawDedupeId.startsWith("aweme:")) return;
  if (attemptedProcessedVideoRescues.has(rawDedupeId)) return;
  if (await state.getProcessedRecordId(rawDedupeId)) return;
  attemptedProcessedVideoRescues.add(rawDedupeId);

  const enrichedSnapshot = await enrichShareCardSnapshot(page, snapshot, {
    inboxUrl: config.douyin.inboxUrl,
    messageSelector: config.douyin.messageSelector,
    openMessageText: config.douyin.openMessageText,
    openChatText: config.douyin.openChatText,
    userDataDir: config.douyin.userDataDir,
    headless: config.douyin.headless,
    offscreen: config.douyin.offscreen,
  });
  if (isUnresolvedDouyinShareCard(enrichedSnapshot)) return;

  const record = captureRecordFromSnapshot(enrichedSnapshot);
  const recordId =
    (await state.getProcessedRecordId(record.dedupeId)) ??
    (await writer.findRecordIdByDedupeId(record.dedupeId).catch(() => undefined));
  if (!recordId) return;
  record.feishuRecordId = recordId;
  await state.markProcessed(record.dedupeId, recordId);
  await enqueueVideoForDeepProcessing(record, "video_deep_processing_requeued");
}

function logProcessResult(result: ProcessResult): void {
  if (result.status === "written") {
    console.log(`feishu_write_success:${result.dedupeId}`);
  } else if (result.status === "duplicate_status_updated") {
    console.log(`feishu_duplicate_status_updated:${result.dedupeId}`);
  } else if (result.status === "queued") {
    console.log(`feishu_write_queued:${result.dedupeId}`);
  }

  if (result.status !== "duplicate") {
    console.log(`capture_${result.status}:${result.dedupeId}`);
  }
}

try {
  if (config.douyin.ignoreExistingOnStart) {
    const snapshots = await collectMessageSnapshots(page, config.douyin.messageSelector);
    for (const snapshot of snapshots.slice(-20)) {
      await markSnapshotProcessed(snapshot);
    }
    console.log(`initial_snapshots_ignored:${snapshots.length}`);
  }

  let loopCount = 0;
  while (!shouldStop && !page.isClosed()) {
    loopCount += 1;
    if (loopCount % 12 === 0) {
      console.log(`monitor_alive:${new Date().toISOString()}`);
    }
    pumpVideoDeepProcessing();
    try {
      const snapshots = await collectMessageSnapshots(page, config.douyin.messageSelector);
      for (const snapshot of snapshots.slice(-20)) {
        const rawDedupeId = dedupeIdForSnapshot(snapshot);
        if (await state.isProcessed(rawDedupeId)) {
          await rescueProcessedVideoWithoutRecordId(snapshot, rawDedupeId);
          continue;
        }

        const enrichedSnapshot = await enrichShareCardSnapshot(page, snapshot, {
          inboxUrl: config.douyin.inboxUrl,
          messageSelector: config.douyin.messageSelector,
          openMessageText: config.douyin.openMessageText,
          openChatText: config.douyin.openChatText,
          userDataDir: config.douyin.userDataDir,
          headless: config.douyin.headless,
          offscreen: config.douyin.offscreen,
        });
        if (isUnresolvedDouyinShareCard(enrichedSnapshot)) {
          if (!skippedShareCardWarnings.has(rawDedupeId)) {
            console.warn(`capture_skipped:share_card_without_url:${rawDedupeId}`);
            skippedShareCardWarnings.add(rawDedupeId);
          }
          continue;
        }

        const enrichedDedupeId = dedupeIdForSnapshot(enrichedSnapshot);
        if (enrichedDedupeId !== rawDedupeId && (await state.isProcessed(enrichedDedupeId))) {
          const result = await processSnapshot(enrichedSnapshot, { state, writer, summarizer });
          await state.markProcessed(rawDedupeId);
          logProcessResult(result);
          continue;
        }

        const result = await processSnapshot(enrichedSnapshot, { state, writer, summarizer });
        if (result.status === "written" && result.record) {
          await enqueueVideoForDeepProcessing(result.record, "video_deep_processing_queued");
        }
        if (enrichedDedupeId !== rawDedupeId) {
          await state.markProcessed(rawDedupeId);
        }
        logProcessResult(result);
      }
    } catch (error) {
      console.error(`monitor_error:${error instanceof Error ? error.message : "unknown"}`);
    }

    if (!shouldStop && !page.isClosed()) {
      await page.waitForTimeout(config.douyin.pollIntervalMs).catch((error) => {
        if (error instanceof Error && error.message.includes("Target page, context or browser has been closed")) {
          shouldStop = true;
          return;
        }
        throw error;
      });
    }
  }
} finally {
  console.log(`monitor_stopped:shouldStop=${shouldStop}:pageClosed=${page.isClosed()}`);
  await close();
}
