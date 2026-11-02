import { readFile } from "node:fs/promises";
import { validateDashscopeApiKey } from "../config/envValidation.js";
export interface QwenRequestInput { model: string; fileUrl: string; hotwords: string[]; groundTruth?: string }

const LOCAL_MEDIA_MAX_BYTES = 16 * 1024 * 1024;
const MEDIA_MIME: Record<string, string> = { ".mp4": "video/mp4", ".m4v": "video/mp4", ".webm": "video/webm", ".m4a": "audio/mp4", ".mp3": "audio/mpeg", ".aac": "audio/aac", ".wav": "audio/wav", ".flac": "audio/flac" };

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

function isLocalMediaPath(rawUrl: string): boolean {
  if (/^[a-zA-Z]:[\\/]/.test(rawUrl)) return true;
  if (/^[\\/]/.test(rawUrl)) return true;
  if (/^\.{1,2}[\\/]/.test(rawUrl)) return true;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/i.test(rawUrl)) return false;
  return true;
}

export async function prepareQwenMediaUrl(rawUrl: string): Promise<string> {
  if (!rawUrl) return "";
  if (/^data:/i.test(rawUrl)) return rawUrl;
  if (isLocalMediaPath(rawUrl)) {
    const bytes = await readFile(rawUrl);
    if (bytes.length > LOCAL_MEDIA_MAX_BYTES) throw new Error(`qwen_asr_local_file_too_large:${bytes.length}`);
    const lower = rawUrl.toLowerCase();
    const ext = Object.keys(MEDIA_MIME).find((e) => lower.endsWith(e)) ?? "";
    const mime = MEDIA_MIME[ext] ?? "application/octet-stream";
    return `data:${mime};base64,${bytes.toString("base64")}`;
  }
  return normalizeMediaUrlForQwen(rawUrl);
}

export function requireDashscopeKey(value: string | undefined): string {
  const normalized = value?.trim();
  if (!normalized || /^REPLACE_WITH_/i.test(normalized)) throw new Error("qwen_asr_missing_DASHSCOPE_API_KEY");
  validateDashscopeApiKey(normalized);
  return normalized;
}

export function buildQwenRequest(input: QwenRequestInput) {
  const corpus = input.hotwords.map((word) => word.trim()).filter(Boolean).join("、");
  if (input.groundTruth && corpus.includes(input.groundTruth)) throw new Error("qwen_asr_ground_truth_prompt_refused");
  return {
    model: input.model,
    input: { file_url: input.fileUrl },
    parameters: { channel_id: [0], language: "zh", enable_itn: false, enable_words: true, corpus: { text: corpus } },
  };
}

function sanitize(value: unknown, key = ""): unknown {
  if (/authorization|api.?key|token|secret|cookie/i.test(key)) return "[REDACTED]";
  if (typeof value === "string" && /^https?:/i.test(value)) {
    try { const url = new URL(value); url.search = ""; return url.toString(); } catch { return "[REDACTED_URL]"; }
  }
  if (Array.isArray(value)) return value.map((item) => sanitize(item));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([childKey, child]) => [childKey, sanitize(child, childKey)]));
  return value;
}

export function sanitizeQwenResponse(value: unknown): any { return sanitize(value); }

export function extractQwenTranscript(value: unknown): { text: string; transcripts: unknown[] } {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("qwen_asr_result_invalid:root");
  const transcripts = (value as Record<string, unknown>).transcripts;
  if (!Array.isArray(transcripts) || transcripts.length === 0) throw new Error("qwen_asr_result_invalid:transcripts");
  const text = transcripts.map((item) => item && typeof item === "object" ? String((item as Record<string, unknown>).text ?? "") : "").join("").trim();
  if (!text) throw new Error("qwen_asr_result_invalid:transcripts");
  return { text, transcripts };
}

export interface QwenHttpOptions { endpoint: string; apiKey: string; request: ReturnType<typeof buildQwenRequest>; fetchImpl?: typeof fetch }

export async function submitQwenTask(options: QwenHttpOptions): Promise<any> {
  const apiKey = requireDashscopeKey(options.apiKey);
  const response = await (options.fetchImpl ?? fetch)(options.endpoint, {
    method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "X-DashScope-Async": "enable" },
    body: JSON.stringify(options.request),
  });
  const payload = await response.json() as any;
  if (!response.ok) throw new Error(`qwen_asr_submit_failed:${response.status}:${String(payload?.code ?? "unknown")}`);
  return payload;
}

export async function pollQwenTask(endpoint: string, taskId: string, apiKeyValue: string, fetchImpl: typeof fetch = fetch): Promise<any> {
  const apiKey = requireDashscopeKey(apiKeyValue);
  const taskEndpoint = endpoint.replace(/\/services\/audio\/asr\/transcription\/?$/, `/tasks/${encodeURIComponent(taskId)}`);
  for (let attempt = 0; attempt < 120; attempt++) {
    const response = await fetchImpl(taskEndpoint, { headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" } });
    const payload = await response.json() as any;
    if (!response.ok) throw new Error(`qwen_asr_poll_failed:${response.status}:${String(payload?.code ?? "unknown")}`);
    const status = String(payload?.output?.task_status ?? "UNKNOWN");
    if (status === "SUCCEEDED") return payload;
    if (status === "FAILED" || status === "UNKNOWN") throw new Error(`qwen_asr_task_${status.toLowerCase()}:${String(payload?.output?.code ?? "unknown")}`);
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  throw new Error("qwen_asr_poll_timeout");
}

export async function fetchQwenTranscriptionResult(url: string, fetchImpl: typeof fetch = fetch): Promise<any> {
  const response = await fetchImpl(url, { redirect: "follow" });
  if (!response.ok) throw new Error(`qwen_asr_result_fetch_failed:${response.status}`);
  return response.json();
}

export interface QwenArtifactInput {
  model: string; startedAt: string; completedAt: string; elapsedSeconds: number;
  submit: unknown; poll: unknown; result: unknown;
}

export function buildQwenArtifact(input: QwenArtifactInput) {
  const extracted = extractQwenTranscript(input.result);
  const poll = sanitizeQwenResponse(input.poll) as any;
  return {
    provider: "qwen-asr", model: input.model, real_call: true,
    started_at: input.startedAt, completed_at: input.completedAt, elapsed_seconds: input.elapsedSeconds,
    usage: poll?.usage ?? null, text: extracted.text,
    submit_response: sanitizeQwenResponse(input.submit), poll_response: poll,
    result: sanitizeQwenResponse(input.result),
  };
}
