import { describe, expect, it } from "vitest";
import { selectAsrProvider } from "../../src/asr/providers.js";
import { buildQwenArtifact, buildQwenRequest, extractQwenTranscript, requireDashscopeKey, sanitizeQwenResponse } from "../../src/asr/qwenAsrClient.js";

describe("ASR providers", () => {
  it("selects supported providers and rejects unknown values", () => {
    expect(selectAsrProvider("whisper-local")).toBe("whisper-local");
    expect(selectAsrProvider("qwen-asr")).toBe("qwen-asr");
    expect(() => selectAsrProvider("mock")).toThrow("asr_provider_unknown:mock");
  });

  it("fails closed when the dedicated Qwen key is missing", () => {
    expect(() => requireDashscopeKey(undefined)).toThrow("qwen_asr_missing_DASHSCOPE_API_KEY");
    expect(() => requireDashscopeKey(" ")).toThrow("qwen_asr_missing_DASHSCOPE_API_KEY");
  });

  it("fails closed when DASHSCOPE_API_KEY still has the local placeholder prefix", () => {
    expect(() => requireDashscopeKey("REPLACE_WITH_REAL_DASHSCOPE_API_KEY")).toThrow("qwen_asr_missing_DASHSCOPE_API_KEY");
    expect(() => requireDashscopeKey("replace_with_something_else")).toThrow("qwen_asr_missing_DASHSCOPE_API_KEY");
  });

  it("passes terminology context but never the complete ground truth", () => {
    const groundTruth = "很多视频收藏了，却再也没时间细看";
    const request = buildQwenRequest({
      model: "qwen3-asr-flash-filetrans", fileUrl: "https://media.example/audio.mp4",
      hotwords: ["Skill", "Agent", "飞书"], groundTruth,
    });
    expect(request.parameters.corpus.text).toBe("Skill、Agent、飞书");
    expect(JSON.stringify(request)).not.toContain(groundTruth);
    expect(request.parameters.enable_words).toBe(true);
  });

  it("redacts credentials and signed URLs from saved responses", () => {
    const sanitized = sanitizeQwenResponse({
      request_id: "req", authorization: "Bearer secret-value",
      output: { result: { transcription_url: "https://oss.example/result?Signature=secret&Expires=1" } },
    });
    expect(JSON.stringify(sanitized)).not.toContain("secret-value");
    expect(JSON.stringify(sanitized)).not.toContain("Signature=");
    expect(sanitized).toMatchObject({ request_id: "req", authorization: "[REDACTED]" });
  });

  it("extracts the exact Qwen filetrans text and timestamp objects", () => {
    const result = { transcripts: [{ channel_id: 0, text: "我这个Skill帮你。", sentences: [
      { sentence_id: 0, begin_time: 0, end_time: 1000, text: "我这个Skill帮你。", words: [{ begin_time: 0, end_time: 100, text: "我", punctuation: "" }] },
    ] }] };
    expect(extractQwenTranscript(result)).toEqual({ text: "我这个Skill帮你。", transcripts: result.transcripts });
  });

  it("rejects a successful task result that has no transcript text", () => {
    expect(() => extractQwenTranscript({ transcripts: [] })).toThrow("qwen_asr_result_invalid:transcripts");
  });

  it("builds a sanitized real-call artifact while retaining exact transcript timestamps", () => {
    const result = { file_url: "https://media.example/video?Signature=input", transcripts: [{ text: "Skill。", sentences: [{ begin_time: 0, end_time: 500, text: "Skill。" }] }] };
    const artifact = buildQwenArtifact({ model: "qwen3-asr-flash-filetrans", startedAt: "start", completedAt: "end", elapsedSeconds: 2, submit: { output: { task_id: "id" } }, poll: { usage: { seconds: 1 }, output: { result: { transcription_url: "https://oss.example/r?Signature=secret" } } }, result });
    expect(artifact.text).toBe("Skill。");
    expect(artifact.result).toMatchObject({ transcripts: result.transcripts });
    expect(JSON.stringify(artifact)).not.toContain("Signature=");
    expect(artifact.real_call).toBe(true);
  });
});
