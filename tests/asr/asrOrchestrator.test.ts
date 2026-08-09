import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { transcribeWithFallback, transcribeWithFasterWhisper } from "../../src/asr/asrOrchestrator.js";
import {
  classifyQwenError, isRecoverableError, isRetryableError,
  type AsrOrchestratorConfig,
} from "../../src/asr/providers.js";

function instantSleep(): Promise<void> { return Promise.resolve(); }

function baseConfig(overrides: Partial<AsrOrchestratorConfig> = {}): AsrOrchestratorConfig {
  return {
    mode: "qwen-primary",
    qwen: { model: "qwen3-asr-flash-filetrans", endpoint: "https://dashscope.aliyuncs.com/api/v1/services/audio/asr/transcription", apiKey: "sk-test-dashscope-key" },
    whisper: { model: "large-v3", pythonPath: "python", scriptPath: "scripts/transcribe-faster-whisper.py", device: "cpu", computeType: "int8", language: "zh" },
    maxRetries: 2,
    hotwords: ["Skill", "Agent"],
    ...overrides,
  };
}

function mockFasterWhisperSuccess() {
  return vi.fn((_command: string, args: string[], callback: (error: Error | null) => void) => {
    void (async () => {
      const outputIdx = args.indexOf("--output");
      const outputPath = outputIdx >= 0 ? args[outputIdx + 1] : "/tmp/whisper-output.json";
      await writeFile(outputPath, JSON.stringify({
        provider: "faster-whisper", model: "large-v3", device: "cpu", compute_type: "int8",
        text: "Local whisper transcribed text.", segments: [{ id: 0, start: 0, end: 1, text: "Local whisper transcribed text.", words: [] }],
        elapsed_seconds: 5.0, started_at: "2026-01-01T00:00:00Z", finished_at: "2026-01-01T00:00:05Z",
      }), "utf8");
      callback(null);
    })();
  });
}

function fastDeps(overrides: Record<string, unknown> = {}) {
  return { sleepImpl: instantSleep, ...overrides };
}

describe("ASR orchestrator", () => {
  it("returns Qwen result on success with no fallback", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: vi.fn().mockResolvedValue({ output: { task_id: "task-001" } }) })
      .mockResolvedValueOnce({ ok: true, json: vi.fn().mockResolvedValue({ output: { task_status: "SUCCEEDED", result: { transcription_url: "https://x.com/r" } } }) })
      .mockResolvedValueOnce({ ok: true, json: vi.fn().mockResolvedValue({ transcripts: [{ text: "Qwen text.", sentences: [{ text: "Qwen text.", words: [] }] }] }) });

    const result = await transcribeWithFallback(
      baseConfig(), "https://x.com/v.mp4", "/tmp/x.mp4", "/tmp/o",
      { fetchImpl: fetchMock as never, execFileImpl: vi.fn() as never },
    );

    expect(result.provider).toBe("qwen-asr");
    expect(result.model).toBe("qwen3-asr-flash-filetrans");
    expect(result.text).toBe("Qwen text.");
    expect(result.fallback).toBeUndefined();
    expect(result.retries).toBe(0);
  });

  it("falls back on missing DASHSCOPE_API_KEY", async () => {
    const cfg = baseConfig({ qwen: { ...baseConfig().qwen, apiKey: undefined } });
    const result = await transcribeWithFallback(
      cfg, "https://x.com/v.mp4", "/tmp/x.mp4", "/tmp/o",
      fastDeps({ execFileImpl: mockFasterWhisperSuccess() as never }),
    );
    expect(result.provider).toBe("faster-whisper-large-v3");
    expect(result.fallback?.primary_error_category).toBe("auth");
    expect(result.fallback?.fallback_reason).toContain("qwen_key_missing");
  });

  it("falls back on placeholder DASHSCOPE_API_KEY", async () => {
    const cfg = baseConfig({ qwen: { ...baseConfig().qwen, apiKey: "REPLACE_WITH_REAL_DASHSCOPE_API_KEY" } });
    const result = await transcribeWithFallback(
      cfg, "https://x.com/v.mp4", "/tmp/x.mp4", "/tmp/o",
      fastDeps({ execFileImpl: mockFasterWhisperSuccess() as never }),
    );
    expect(result.provider).toBe("faster-whisper-large-v3");
    expect(result.fallback?.primary_error_category).toBe("auth");
  });

  it("no retry on auth error, immediate fallback", async () => {
    let fc = 0;
    const fm = vi.fn().mockImplementation(() => { fc++; return Promise.resolve({ ok: false, status: 401, json: vi.fn().mockResolvedValue({ code: "InvalidApiKey" }) }); });
    const result = await transcribeWithFallback(
      baseConfig(), "https://x.com/v.mp4", "/tmp/x.mp4", "/tmp/o",
      fastDeps({ fetchImpl: fm as never, execFileImpl: mockFasterWhisperSuccess() as never }),
    );
    expect(fc).toBe(1);
    expect(result.provider).toBe("faster-whisper-large-v3");
    expect(result.fallback?.primary_error_category).toBe("auth");
  });

  it("retries on network errors then falls back", async () => {
    const fm = vi.fn().mockRejectedValue(new Error("connect ECONNREFUSED"));
    const result = await transcribeWithFallback(
      baseConfig(), "https://x.com/v.mp4", "/tmp/x.mp4", "/tmp/o",
      fastDeps({ fetchImpl: fm as never, execFileImpl: mockFasterWhisperSuccess() as never }),
    );
    expect(fm).toHaveBeenCalledTimes(3);
    expect(result.provider).toBe("faster-whisper-large-v3");
    expect(result.fallback?.primary_error_category).toBe("network");
    expect(result.fallback?.fallback_reason).toContain("ECONNREFUSED");
  });

  it("falls back on 503 after retries exhausted", async () => {
    const fm = vi.fn().mockResolvedValue({ ok: false, status: 503, json: vi.fn().mockResolvedValue({ code: "ServiceUnavailable" }) });
    const result = await transcribeWithFallback(
      baseConfig(), "https://x.com/v.mp4", "/tmp/x.mp4", "/tmp/o",
      fastDeps({ fetchImpl: fm as never, execFileImpl: mockFasterWhisperSuccess() as never }),
    );
    expect(fm).toHaveBeenCalledTimes(3);
    expect(result.provider).toBe("faster-whisper-large-v3");
    expect(result.fallback?.primary_error_category).toBe("service");
  });

  it("large-v3-only skips Qwen", async () => {
    const cfg = baseConfig({ mode: "large-v3-only" });
    const result = await transcribeWithFallback(
      cfg, "unused", "/tmp/x.mp4", "/tmp/o",
      fastDeps({ execFileImpl: mockFasterWhisperSuccess() as never }),
    );
    expect(result.provider).toBe("faster-whisper-large-v3");
    expect(result.fallback).toBeUndefined();
  });

  it("fallback record contains full metadata", async () => {
    const fm = vi.fn().mockRejectedValue(new Error("connect ETIMEDOUT"));
    const result = await transcribeWithFallback(
      baseConfig(), "https://x.com/v.mp4", "/tmp/x.mp4", "/tmp/o",
      fastDeps({ fetchImpl: fm as never, execFileImpl: mockFasterWhisperSuccess() as never }),
    );
    expect(result.fallback).toBeDefined();
    expect(result.fallback!.primary_provider).toBe("qwen-asr");
    expect(result.fallback!.primary_model).toBe("qwen3-asr-flash-filetrans");
    expect(result.fallback!.primary_error_category).toBe("network");
    expect(result.fallback!.fallback_reason).toMatch(/^network:/);
    expect(result.fallback!.fallback_provider).toBe("faster-whisper-large-v3");
    expect(result.fallback!.fallback_model).toBe("large-v3");
  });

  it("never falls back to whisper-base", async () => {
    const cfg = baseConfig({ mode: "large-v3-only" });
    const result = await transcribeWithFallback(
      cfg, "unused", "/tmp/x.mp4", "/tmp/o",
      fastDeps({ execFileImpl: mockFasterWhisperSuccess() as never }),
    );
    expect(result.model).toBe("large-v3");
    expect(result.provider).not.toBe("whisper-base");
  });
});

describe("error classification", () => {
  it("auth: non-retryable, non-recoverable", () => {
    expect(classifyQwenError(new Error("qwen_asr_missing_DASHSCOPE_API_KEY"))).toBe("auth");
    expect(classifyQwenError(new Error("HTTP 401"))).toBe("auth");
    expect(isRetryableError("auth")).toBe(false);
    expect(isRecoverableError("auth")).toBe(false);
  });

  it("network: retryable and recoverable", () => {
    expect(classifyQwenError(new Error("connect ECONNREFUSED"))).toBe("network");
    expect(classifyQwenError(new Error("ETIMEDOUT"))).toBe("network");
    expect(classifyQwenError(new Error("ENOTFOUND"))).toBe("network");
    expect(isRetryableError("network")).toBe(true);
    expect(isRecoverableError("network")).toBe(true);
  });

  it("service: retryable and recoverable (checked before network)", () => {
    expect(classifyQwenError(new Error("HTTP 502"))).toBe("service");
    expect(classifyQwenError(new Error("HTTP 504 Gateway Timeout"))).toBe("service");
    expect(isRetryableError("service")).toBe(true);
    expect(isRecoverableError("service")).toBe(true);
  });

  it("poll_timeout: recoverable, not retryable", () => {
    expect(classifyQwenError(new Error("qwen_asr_poll_timeout"))).toBe("poll_timeout");
    expect(isRecoverableError("poll_timeout")).toBe(true);
    expect(isRetryableError("poll_timeout")).toBe(false);
  });

  it("parse: retryable, not recoverable", () => {
    expect(classifyQwenError(new Error("qwen_asr_result_invalid:transcripts"))).toBe("parse");
    expect(isRetryableError("parse")).toBe(true);
    expect(isRecoverableError("parse")).toBe(false);
  });
});

describe("transcribeWithFasterWhisper", () => {
  it("returns structured result", async () => {
    const dir = await mkdtemp(join(tmpdir(), "asr-orch-"));
    try {
      const result = await transcribeWithFasterWhisper(
        baseConfig().whisper, "/tmp/x.mp4", dir, mockFasterWhisperSuccess() as never,
      );
      expect(result.provider).toBe("faster-whisper-large-v3");
      expect(result.model).toBe("large-v3");
      expect(result.text).toBe("Local whisper transcribed text.");
      expect(result.elapsed_seconds).toBeGreaterThanOrEqual(0);
      expect(result.retries).toBe(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
