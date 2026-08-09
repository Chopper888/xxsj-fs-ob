import "dotenv/config";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { artifactNames, assertComparisonScope } from "../src/asr/comparisonWorkflow.js";
import { formatReadableSegments } from "../src/asr/readable.js";
import {
  buildQwenArtifact, buildQwenRequest, extractQwenTranscript, fetchQwenTranscriptionResult,
  pollQwenTask, requireDashscopeKey, submitQwenTask,
} from "../src/asr/qwenAsrClient.js";

const root = resolve(import.meta.dirname, "..");
const recordId = process.argv[process.argv.indexOf("--record-id") + 1] || "recvr510Ek3WgD";
assertComparisonScope(recordId);
const taskDir = join(root, "data", "tasks", recordId);
const outputDir = join(taskDir, "asr-comparison");
const model = process.env.QWEN_ASR_MODEL?.trim() || "qwen3-asr-flash-filetrans";
const endpoint = process.env.QWEN_ASR_ENDPOINT?.trim() || "https://dashscope.aliyuncs.com/api/v1/services/audio/asr/transcription";
const names = artifactNames("large-v3", model);

async function main() {
  const apiKey = requireDashscopeKey(process.env.DASHSCOPE_API_KEY);
  const media = JSON.parse(await readFile(join(taskDir, "preview", "media-links.json"), "utf8")) as any;
  const hotwords = (process.env.ASR_HOTWORDS || "Skill,Agent,MCP,API,Codex,Claude,ComfyUI,Obsidian,飞书,知识库,知识图景").split(",").map((item) => item.trim()).filter(Boolean);
  const request = buildQwenRequest({ model, fileUrl: String(media.resolved_download_url), hotwords });
  const started = Date.now();
  const submit = await submitQwenTask({ endpoint, apiKey, request });
  const taskId = String(submit?.output?.task_id ?? "");
  if (!taskId) throw new Error("qwen_asr_submit_invalid:task_id");
  const poll = await pollQwenTask(endpoint, taskId, apiKey);
  const resultUrl = String(poll?.output?.result?.transcription_url ?? "");
  if (!resultUrl) throw new Error("qwen_asr_poll_invalid:transcription_url");
  const result = await fetchQwenTranscriptionResult(resultUrl);
  const completed = Date.now();
  const artifact = buildQwenArtifact({
    model, startedAt: new Date(started).toISOString(), completedAt: new Date(completed).toISOString(),
    elapsedSeconds: (completed - started) / 1000, submit, poll, result,
  });
  const extracted = extractQwenTranscript(result);
  const sentenceTexts = extracted.transcripts.flatMap((transcript: any) => Array.isArray(transcript?.sentences) ? transcript.sentences.map((sentence: any) => String(sentence?.text ?? "")) : []);
  const readable = sentenceTexts.length ? formatReadableSegments(sentenceTexts) : extracted.text;
  await writeFile(join(outputDir, names.qwenOriginal), `${JSON.stringify(artifact, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  await writeFile(join(outputDir, names.qwenReadable), `${readable.trim()}\n`, { encoding: "utf8", flag: "wx" });
  console.log(JSON.stringify({ status: "completed", authenticated: true, model, elapsed_seconds: artifact.elapsed_seconds, usage: artifact.usage, output: names.qwenOriginal }, null, 2));
}

main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
