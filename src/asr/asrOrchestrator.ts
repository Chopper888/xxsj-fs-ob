import { execFile as nodeExecFile } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  buildQwenArtifact, buildQwenRequest, extractQwenTranscript,
  fetchQwenTranscriptionResult, pollQwenTask, requireDashscopeKey, submitQwenTask,
  type QwenHttpOptions,
} from "./qwenAsrClient.js";
import {
  classifyQwenError, isRecoverableError, isRetryableError,
  type AsrErrorCategory, type AsrOrchestratorConfig,
  type AsrFallbackRecord, type AsrTranscriptionResult,
} from "./providers.js";

type ExecFile = typeof nodeExecFile;

interface OrchestratorDeps {
  execFileImpl?: ExecFile;
  fetchImpl?: typeof fetch;
  sleepImpl?: (ms: number) => Promise<void>;
}

interface WhisperOutput {
  provider: string;
  model: string;
  device: string;
  compute_type: string;
  text: string;
  segments: Array<{
    id: number; start: number; end: number; text: string;
    words?: Array<{ start: number; end: number; word: string; probability: number }>;
  }>;
  elapsed_seconds: number;
  started_at: string;
  finished_at: string;
  [key: string]: unknown;
}

function firstNonEmptyLine(value: string | undefined): string {
  return (value ?? "").split("\n").map((line) => line.trim()).find(Boolean) ?? "";
}

function lastNonEmptyLine(value: string | undefined): string {
  return (value ?? "").split("\n").map((line) => line.trim()).filter(Boolean).at(-1) ?? "";
}

function compactProcessError(command: string, error: Error, stdout?: string | Buffer, stderr?: string | Buffer): Error {
  const stderrText = String(stderr ?? (error as any).stderr ?? "");
  const outputText = stderrText || String(stdout ?? (error as any).stdout ?? "");
  const detail = stderrText.includes("Traceback")
    ? lastNonEmptyLine(outputText)
    : firstNonEmptyLine(outputText) || error.message.split("\n")[0] || "unknown";
  const label = command.split(/[\\/]/).filter(Boolean).at(-1) ?? command;
  return new Error(`${label}_failed:${detail || "unknown"}`);
}

function execFileAsync(execFileImpl: ExecFile, command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFileImpl(command, args, (error, stdout, stderr) => {
      if (error) { reject(compactProcessError(command, error, stdout, stderr)); return; }
      resolve();
    });
  });
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function transcribeWithFasterWhisper(
  config: AsrOrchestratorConfig["whisper"],
  mediaPath: string,
  outputDir: string,
  execFileImpl: ExecFile = nodeExecFile,
): Promise<AsrTranscriptionResult> {
  const started = new Date();
  const outputPath = join(outputDir, "faster-whisper-large-v3.json");
  await mkdir(outputDir, { recursive: true });
  await execFileAsync(execFileImpl, config.pythonPath, [
    config.scriptPath, mediaPath,
    "--model", config.model,
    "--language", config.language,
    "--device", config.device,
    "--compute-type", config.computeType,
    "--output", outputPath,
    "--overwrite",
  ]);
  const raw = JSON.parse(await readFile(outputPath, "utf8")) as WhisperOutput;
  const completed = new Date();
  return {
    provider: "faster-whisper-large-v3",
    model: raw.model,
    text: raw.text,
    segments: raw.segments,
    elapsed_seconds: (completed.getTime() - started.getTime()) / 1000,
    retries: 0,
    started_at: started.toISOString(),
    completed_at: completed.toISOString(),
  };
}

export function normalizeMediaUrlForQwen(rawUrl: string): string {
  if (!rawUrl) return "";
  try {
    const u = new URL(rawUrl);
    if (!/^https?:$/.test(u.protocol)) throw new Error("invalid_media_url_scheme");
    const encoded = u.toString();
    return /[\u0080-\uffff]/.test(encoded) ? encodeURI(rawUrl) : encoded;
  } catch {
    if (/[\u0080-\uffff]/.test(rawUrl)) return encodeURI(rawUrl);
    throw new Error("invalid_media_url_cannot_parse");
  }
}

async function tryQwenOnce(
  config: AsrOrchestratorConfig["qwen"],
  mediaUrl: string,
  hotwords: string[],
  fetchImpl: typeof fetch,
): Promise<AsrTranscriptionResult> {
  const apiKey = requireDashscopeKey(config.apiKey);
  const normalizedUrl = normalizeMediaUrlForQwen(mediaUrl);
  const request = buildQwenRequest({ model: config.model, fileUrl: normalizedUrl, hotwords });
  const options: QwenHttpOptions = { endpoint: config.endpoint, apiKey, request, fetchImpl };
  const started = Date.now();
  const submit = await submitQwenTask(options);
  const taskId = String(submit?.output?.task_id ?? "");
  if (!taskId) throw new Error("qwen_asr_submit_invalid:task_id");
  const poll = await pollQwenTask(config.endpoint, taskId, apiKey, fetchImpl);
  const resultUrl = String(poll?.output?.result?.transcription_url ?? "");
  if (!resultUrl) throw new Error("qwen_asr_poll_invalid:transcription_url");
  const result = await fetchQwenTranscriptionResult(resultUrl, fetchImpl);
  const completed = Date.now();
  const artifact = buildQwenArtifact({
    model: config.model,
    startedAt: new Date(started).toISOString(),
    completedAt: new Date(completed).toISOString(),
    elapsedSeconds: (completed - started) / 1000,
    submit, poll, result,
  });
  const extracted = extractQwenTranscript(result);
  return {
    provider: "qwen-asr",
    model: config.model,
    text: extracted.text,
    segments: extracted.transcripts,
    elapsed_seconds: artifact.elapsed_seconds,
    retries: 0,
    started_at: artifact.started_at,
    completed_at: artifact.completed_at,
  };
}

function buildFallbackRecord(
  error: Error, attempt: number, config: AsrOrchestratorConfig,
): AsrFallbackRecord {
  const category = classifyQwenError(error);
  return {
    primary_provider: "qwen-asr",
    primary_model: config.qwen.model,
    primary_error_category: category,
    fallback_reason: `${category}:${String(error.message ?? error)}`,
    fallback_provider: "faster-whisper-large-v3",
    fallback_model: config.whisper.model,
  };
}

export async function transcribeWithFallback(
  config: AsrOrchestratorConfig,
  mediaUrl: string,
  mediaPath: string,
  outputDir: string,
  deps: OrchestratorDeps = {},
): Promise<AsrTranscriptionResult> {
  const execFileImpl = deps.execFileImpl ?? nodeExecFile;
  const fetchImpl = deps.fetchImpl ?? fetch;
  const sleepImpl = deps.sleepImpl ?? sleep;

  if (config.mode === "large-v3-only") {
    return transcribeWithFasterWhisper(config.whisper, mediaPath, outputDir, execFileImpl);
  }

  try {
    requireDashscopeKey(config.qwen.apiKey);
  } catch {
    const fallback: AsrFallbackRecord = {
      primary_provider: "qwen-asr",
      primary_model: config.qwen.model,
      primary_error_category: "auth",
      fallback_reason: "auth:qwen_key_missing_or_placeholder",
      fallback_provider: "faster-whisper-large-v3",
      fallback_model: config.whisper.model,
    };
    const result = await transcribeWithFasterWhisper(config.whisper, mediaPath, outputDir, execFileImpl);
    return { ...result, fallback };
  }

  let lastCategory: AsrErrorCategory = "unknown";
  const maxAttempts = config.maxRetries + 1;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const result = await tryQwenOnce(config.qwen, mediaUrl, config.hotwords, fetchImpl);
      return { ...result, retries: attempt };
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      lastCategory = classifyQwenError(err);

      if (lastCategory === "auth") {
        const fallback = buildFallbackRecord(err, attempt, config);
        const result = await transcribeWithFasterWhisper(config.whisper, mediaPath, outputDir, execFileImpl);
        return { ...result, fallback };
      }

      if (isRetryableError(lastCategory) && attempt < maxAttempts - 1) {
        const delay = Math.min(2_000 * Math.pow(2, attempt), 16_000);
        await sleepImpl(delay);
        continue;
      }

      if (isRecoverableError(lastCategory)) {
        const fallback = buildFallbackRecord(err, attempt, config);
        const result = await transcribeWithFasterWhisper(config.whisper, mediaPath, outputDir, execFileImpl);
        return { ...result, fallback };
      }

      const fallback = buildFallbackRecord(err, attempt, config);
      const result = await transcribeWithFasterWhisper(config.whisper, mediaPath, outputDir, execFileImpl);
      return { ...result, fallback };
    }
  }

  const safetyFallback: AsrFallbackRecord = {
    primary_provider: "qwen-asr",
    primary_model: config.qwen.model,
    primary_error_category: lastCategory,
    fallback_reason: "exhausted_all_retries",
    fallback_provider: "faster-whisper-large-v3",
    fallback_model: config.whisper.model,
  };
  const result = await transcribeWithFasterWhisper(config.whisper, mediaPath, outputDir, execFileImpl);
  return { ...result, fallback: safetyFallback };
}
