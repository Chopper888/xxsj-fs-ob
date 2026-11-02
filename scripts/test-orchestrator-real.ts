import "dotenv/config";
import { join } from "node:path";
import { readFile, mkdir } from "node:fs/promises";
import { transcribeWithFallback } from "../src/asr/asrOrchestrator.js";

const taskDir = "data/tasks/recvr510Ek3WgD";
const mediaLinks = JSON.parse(await readFile(join(taskDir, "preview", "media-links.json"), "utf8")) as { resolved_download_url: string };
const mediaUrl = mediaLinks.resolved_download_url;
const mediaPath = join(taskDir, "media", "source.mp4");
const outputDir = join(taskDir, "asr-comparison");
await mkdir(outputDir, { recursive: true });

const cfg = {
  mode: "qwen-primary" as const,
  qwen: {
    model: process.env.QWEN_ASR_MODEL?.trim() || "qwen3-asr-flash-filetrans",
    endpoint: process.env.QWEN_ASR_ENDPOINT?.trim() || "https://dashscope.aliyuncs.com/api/v1/services/audio/asr/transcription",
    apiKey: process.env.DASHSCOPE_API_KEY,
  },
  whisper: {
    model: process.env.WHISPER_MODEL?.trim() || "large-v3",
    pythonPath: ".venv/Scripts/python.exe",
    scriptPath: "scripts/transcribe-faster-whisper.py",
    device: "cuda",
    computeType: "float16",
    language: "zh",
  },
  maxRetries: 2,
  hotwords: (process.env.ASR_HOTWORDS || "Skill,Agent").split(","),
};

const result = await transcribeWithFallback(cfg, mediaUrl, mediaPath, outputDir);
const { provider, model, text, retries, elapsed_seconds, fallback } = result;
console.log(JSON.stringify({
  provider, model,
  text_length: text.length,
  text_preview: text.slice(0, 80),
  retries, elapsed_seconds,
  has_fallback: !!fallback,
  fallback_reason: fallback?.fallback_reason ?? null,
}, null, 2));
