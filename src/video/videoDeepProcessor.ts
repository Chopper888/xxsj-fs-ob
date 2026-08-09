import { execFile as nodeExecFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Converter } from "opencc-js";
import type { BrowserContext } from "playwright";
import type { CaptureRecord, SummaryResult } from "../domain/types.js";
import type { LarkCliFeishuWriter } from "../feishu/larkCliWriter.js";
import { mapRecordToFeishuFields } from "../feishu/recordMapper.js";
import { captureDouyinMediaFromPage } from "../media/douyinMediaCapture.js";
import type { SummaryClient } from "../summary/summarizer.js";
import { transcribeWithFallback } from "../asr/asrOrchestrator.js";
import { buildOrchestratorConfigFromEnv, type AsrTranscriptionResult } from "../asr/providers.js";
import { VideoJobStore, type VideoJob } from "./videoJobStore.js";

type ExecFile = typeof nodeExecFile;
type CaptureMediaFromPage = typeof captureDouyinMediaFromPage;
type VideoDeepProcessorEvent =
  | "started"
  | "media_captured"
  | "using_video_input"
  | "transcript_written"
  | "summary_written"
  | "writeback_done"
  | "done"
  | "deferred"
  | "failed";

interface WhisperTranscript {
  text?: string;
  segments?: Array<{ start: number; end: number; text: string }>;
}

export interface VideoDeepProcessorOptions {
  rootDir: string;
  browserContext: BrowserContext;
  writer: Pick<LarkCliFeishuWriter, "writeFields">;
  summarizer: SummaryClient;
  pythonPath: string;
  whisperScriptPath: string;
  transcriptModel: string;
  transcriptLanguage: string;
  transcriptComputeType: string;
  hideBrowser: boolean;
  onEvent?: (event: VideoDeepProcessorEvent, job: VideoJob, detail?: string) => void;
  execFileImpl?: ExecFile;
  captureMediaImpl?: CaptureMediaFromPage;
  asrTranscriber?: (mediaUrl: string, mediaPath: string, outputDir: string) => Promise<AsrTranscriptionResult>;
}

interface ExecFailure extends Error {
  stderr?: string;
  stdout?: string;
}

const traditionalToSimplified = Converter({ from: "t", to: "cn" });

function simplifyChineseText(value: string): string {
  return traditionalToSimplified(value);
}

function safeFileId(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "_");
}

function firstNonEmptyLine(value: string | undefined): string {
  return (value ?? "")
    .split("\n")
    .map((line) => line.trim())
    .find(Boolean) ?? "";
}

function lastNonEmptyLine(value: string | undefined): string {
  return (
    (value ?? "")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .at(-1) ?? ""
  );
}

function commandLabel(command: string): string {
  return command.split(/[\\/]/).filter(Boolean).at(-1) ?? command;
}

function compactProcessError(command: string, error: Error, stdout?: string | Buffer, stderr?: string | Buffer): Error {
  const processError = error as ExecFailure;
  const stderrText = String(stderr ?? processError.stderr ?? "");
  const outputText = stderrText || String(stdout ?? processError.stdout ?? "");
  const detail =
    stderrText.includes("Traceback")
      ? lastNonEmptyLine(outputText)
      : firstNonEmptyLine(outputText) || error.message.split("\n")[0] || "unknown";
  return new Error(`${commandLabel(command)}_failed:${detail || "unknown"}`);
}

function execFileAsync(execFileImpl: ExecFile, command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFileImpl(command, args, (error, stdout, stderr) => {
      if (error) {
        reject(compactProcessError(command, error, stdout, stderr));
        return;
      }
      resolve();
    });
  });
}

function compactTranscriptText(transcript: WhisperTranscript): string {
  const text = transcript.text?.trim();
  if (text) return text;
  return (transcript.segments ?? [])
    .map((segment) => segment.text.trim())
    .filter(Boolean)
    .join("");
}

function isGenericDouyinTitle(value: string): boolean {
  return (
    value.includes("海量优质视频内容") ||
    value.includes("你想要的好内容，都在抖音精选") ||
    value.includes("系列合集内容连续看")
  );
}

function safeVideoTitle(job: VideoJob): string {
  if (!isGenericDouyinTitle(job.title)) return job.title;
  const author = job.author ?? job.record.author;
  return author ? `${author} 分享的视频` : "抖音视频";
}

function isBrowserContextClosedError(message: string): boolean {
  return (
    message.includes("Target page, context or browser has been closed") ||
    message.includes("Browser context has been closed")
  );
}

export class VideoDeepProcessor {
  private readonly store: VideoJobStore;
  private readonly execFileImpl: ExecFile;
  private readonly captureMedia: CaptureMediaFromPage;
  private running = false;

  constructor(private readonly options: VideoDeepProcessorOptions) {
    this.store = new VideoJobStore(options.rootDir);
    this.execFileImpl = options.execFileImpl ?? nodeExecFile;
    this.captureMedia = options.captureMediaImpl ?? captureDouyinMediaFromPage;
  }

  async enqueue(record: CaptureRecord): Promise<"enqueued" | "skipped"> {
    return this.store.enqueue(record);
  }

  async pump(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const job = await this.store.nextPending();
      if (!job) return;
      await this.process(job);
    } finally {
      this.running = false;
    }
  }

  private pathsFor(job: VideoJob): { mediaPath: string; transcriptName: string; transcriptPath: string } {
    const id = safeFileId(job.dedupeId);
    const transcriptName = `${id}.whisper`;
    return {
      mediaPath: join(this.options.rootDir, "media", `${id}.mp4`),
      transcriptName,
      transcriptPath: join(this.options.rootDir, "transcripts", `${transcriptName}.json`),
    };
  }

  private async process(job: VideoJob): Promise<void> {
    const now = new Date().toISOString();
    const processingJob: VideoJob = { ...job, status: "processing", attempts: job.attempts + 1, updatedAt: now };
    await this.store.update(processingJob);
    this.options.onEvent?.("started", processingJob);

    try {
      const paths = this.pathsFor(job);
      await mkdir(join(this.options.rootDir, "media"), { recursive: true });
      await mkdir(join(this.options.rootDir, "transcripts"), { recursive: true });

      const page = await this.options.browserContext.newPage();
      try {
        await this.captureMedia(page, job.url, paths.mediaPath, 25000, undefined, this.options.hideBrowser);
        this.options.onEvent?.("media_captured", processingJob);
      } finally {
        await page.close().catch(() => undefined);
      }

      const transcriptInputPath = paths.mediaPath;
      this.options.onEvent?.("using_video_input", processingJob, "direct_video");

      let transcriptText: string;
      if (this.options.asrTranscriber) {
        const asrResult = await this.options.asrTranscriber(job.url, transcriptInputPath, join(this.options.rootDir, "transcripts"));
        await writeFile(paths.transcriptPath, JSON.stringify(asrResult, null, 2), "utf8");
        this.options.onEvent?.("transcript_written", processingJob, `provider=${asrResult.provider}:model=${asrResult.model}`);
        transcriptText = simplifyChineseText(asrResult.text);
      } else {
        await execFileAsync(this.execFileImpl, this.options.pythonPath, [
          this.options.whisperScriptPath,
          transcriptInputPath,
          "--model", this.options.transcriptModel,
          "--language", this.options.transcriptLanguage,
          "--compute-type", this.options.transcriptComputeType,
          "--output-dir", join(this.options.rootDir, "transcripts"),
          "--output-name", paths.transcriptName,
        ]);
        this.options.onEvent?.("transcript_written", processingJob);
        const transcript = JSON.parse(await readFile(paths.transcriptPath, "utf8")) as WhisperTranscript;
        transcriptText = simplifyChineseText(compactTranscriptText(transcript));
      }
      if (!transcriptText) throw new Error("transcript_empty");
      const title = safeVideoTitle(job);

      const rawSummary: SummaryResult = await this.options.summarizer.summarizeText({
        title,
        text: transcriptText,
        contentType: "video",
      });
      const summary: SummaryResult = {
        summary: simplifyChineseText(rawSummary.summary),
        suggestedCategory: simplifyChineseText(rawSummary.suggestedCategory),
      };
      this.options.onEvent?.("summary_written", processingJob);

      const updatedRecord: CaptureRecord = {
        ...job.record,
        feishuRecordId: job.feishuRecordId ?? job.record.feishuRecordId,
        title,
        text: transcriptText,
        summary,
        status: "transcribed",
        errorMessage: undefined,
      };
      const writeResult = await this.options.writer.writeFields(mapRecordToFeishuFields(updatedRecord), {
        recordId: updatedRecord.feishuRecordId,
        lookupDedupeId: job.dedupeId,
        createIfMissing: false,
      });
      const writtenFeishuRecordId = writeResult?.recordId ?? updatedRecord.feishuRecordId;
      this.options.onEvent?.("writeback_done", processingJob);

      await this.store.update({
        ...processingJob,
        feishuRecordId: writtenFeishuRecordId,
        record: { ...updatedRecord, feishuRecordId: writtenFeishuRecordId },
        status: "done",
        updatedAt: new Date().toISOString(),
        transcriptPath: paths.transcriptPath,
        mediaPath: paths.mediaPath,
        audioPath: undefined,
        errorMessage: undefined,
      });
      this.options.onEvent?.("done", { ...processingJob, status: "done", updatedAt: new Date().toISOString() });
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown_video_deep_processing_error";
      if (isBrowserContextClosedError(message)) {
        this.options.onEvent?.("deferred", processingJob, "browser_context_closed");
        await this.store.update({
          ...processingJob,
          status: "pending",
          updatedAt: new Date().toISOString(),
          errorMessage: message,
        });
        return;
      }

      this.options.onEvent?.("failed", processingJob, message);
      await this.options.writer
        .writeFields(
          {
            "处理状态": "needs_manual_review",
            "错误信息": message,
            "去重 ID": job.dedupeId,
          },
          {
            recordId: job.feishuRecordId ?? job.record.feishuRecordId,
            lookupDedupeId: job.dedupeId,
            createIfMissing: false,
          },
        )
        .catch(() => undefined);
      await this.store.update({
        ...processingJob,
        status: "failed",
        updatedAt: new Date().toISOString(),
        errorMessage: message,
      });
      throw error;
    }
  }
}
