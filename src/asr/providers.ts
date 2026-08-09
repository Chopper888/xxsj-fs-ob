export type AsrProvider = "whisper-local" | "qwen-asr";

export function selectAsrProvider(value: string): AsrProvider {
  if (value === "whisper-local" || value === "qwen-asr") return value;
  throw new Error(`asr_provider_unknown:${value}`);
}

// === primary/fallback orchestration types ===

export type AsrMode = "qwen-primary" | "large-v3-only";

export type AsrErrorCategory =
  | "network"      // DNS, connect, read timeout — recoverable
  | "service"      // 502, 503, 504 — recoverable
  | "auth"         // 401, missing/placeholder key — fatal, no retry
  | "parse"        // malformed response
  | "poll_timeout" // 120 poll attempts exhausted
  | "unknown";

export interface AsrFallbackRecord {
  primary_provider: "qwen-asr";
  primary_model: string;
  primary_error_category: AsrErrorCategory;
  fallback_reason: string;
  fallback_provider: "faster-whisper-large-v3";
  fallback_model: string;
}

export interface AsrTranscriptionResult {
  provider: string;
  model: string;
  text: string;
  segments: unknown[];
  elapsed_seconds: number;
  retries: number;
  started_at: string;
  completed_at: string;
  fallback?: AsrFallbackRecord;
}

export interface AsrOrchestratorConfig {
  mode: AsrMode;
  qwen: {
    model: string;
    endpoint: string;
    apiKey?: string;
  };
  whisper: {
    model: string;
    pythonPath: string;
    scriptPath: string;
    device: string;
    computeType: string;
    language: string;
  };
  maxRetries: number;
  hotwords: string[];
}

export function classifyQwenError(error: Error): AsrErrorCategory {
  const message = String(error?.message ?? error);
  if (/missing_DASHSCOPE_API_KEY|placeholder|auth|401|403/i.test(message)) return "auth";
  if (/502|503|504|service.unavailable|internal.server.error/i.test(message)) return "service";
  if (/poll_timeout/i.test(message)) return "poll_timeout";
  if (/connect|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ETIMEDOUT/i.test(message)) return "network";
  if (/invalid|parse|malformed|result_fetch_failed/i.test(message)) return "parse";
  return "unknown";
}

export function isRecoverableError(category: AsrErrorCategory): boolean {
  return category === "network" || category === "service" || category === "poll_timeout";
}

export function isRetryableError(category: AsrErrorCategory): boolean {
  return category === "network" || category === "service" || category === "parse";
}

export function buildOrchestratorConfigFromEnv(env: Record<string, string | undefined> = process.env): AsrOrchestratorConfig {
  const mode = env.ASR_MODE?.trim() === "large-v3-only" ? "large-v3-only" as const : "qwen-primary" as const;
  return {
    mode,
    qwen: {
      model: env.QWEN_ASR_MODEL?.trim() || "qwen3-asr-flash-filetrans",
      endpoint: env.QWEN_ASR_ENDPOINT?.trim() || "https://dashscope.aliyuncs.com/api/v1/services/audio/asr/transcription",
      apiKey: env.DASHSCOPE_API_KEY,
    },
    whisper: {
      model: env.WHISPER_MODEL?.trim() || "large-v3",
      pythonPath: env.TRANSCRIBE_PYTHON_PATH?.trim() || ".venv/Scripts/python.exe",
      scriptPath: env.WHISPER_SCRIPT_PATH?.trim() || "scripts/transcribe-faster-whisper.py",
      device: env.WHISPER_DEVICE?.trim() || "cuda",
      computeType: env.WHISPER_COMPUTE_TYPE?.trim() || "float16",
      language: env.TRANSCRIBE_LANGUAGE?.trim() || "zh",
    },
    maxRetries: Number(env.ASR_MAX_RETRIES ?? 2),
    hotwords: (env.ASR_HOTWORDS || "Skill,Agent,MCP,API,Codex,Claude,ComfyUI,Obsidian").split(",").map((s) => s.trim()).filter(Boolean),
  };
}
