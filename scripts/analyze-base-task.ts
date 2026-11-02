import "dotenv/config";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { buildAnalysisSystemPrompt, parseAndValidateAnalysis } from "../src/analysis/contentAnalysis.js";
import { loadConfigFromEnv } from "../src/config.js";
import { OpenAICompatibleSummaryClient } from "../src/summary/openaiCompatibleClient.js";

type Fields = Record<string, unknown>;
const root = resolve(import.meta.dirname, "..");
const recordId = process.argv[process.argv.indexOf("--record-id") + 1];
const dryRun = process.argv.includes("--dry-run");
if (!recordId || recordId.startsWith("--")) throw new Error("usage: --record-id <id> [--dry-run]");

const config = loadConfigFromEnv(process.env);
if (config.summary.mode !== "openai" || !config.summary.apiKey) throw new Error("real_summary_config_required");
const taskDir = join(root, "data", "tasks", recordId);
const analysisDir = join(taskDir, "analysis");
const paths = {
  input: join(analysisDir, "input.json"),
  rawResponse: join(analysisDir, "raw-response.txt"),
  result: join(analysisDir, "result.json"),
  validationLog: join(analysisDir, "validation.log"),
};

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`missing_env:${name}`);
  return value;
}

async function baseApi(path: string): Promise<any> {
  const tokenFile = process.env.FEISHU_TOKEN_FILE ?? ".feishu_token.txt";
  const token = (await readFile(tokenFile, "utf8")).trim();
  const url = `https://open.feishu.cn/open-apis/bitable/v1/apps/${required("FEISHU_BASE_TOKEN")}/tables/${required("FEISHU_TABLE_ID")}${path}`;
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const payload = await response.json() as any;
  if (!response.ok || payload.code !== 0) throw new Error(`base_read_failed:${payload.code ?? response.status}`);
  return payload.data;
}

function isoDate(value: unknown): string | null {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? new Date(number).toISOString() : null;
}

async function main() {
  const record = (await baseApi(`/records/${recordId}`)).record as { fields: Fields };
  const fieldItems = (await baseApi("/fields?page_size=100")).items as Array<any>;
  const fields = record.fields;
  if (fields["处理状态"] !== "draft_ready") throw new Error(`analysis_status_refused:${String(fields["处理状态"] ?? "missing")}`);
  const primaryField = fieldItems.find((field) => field.field_name === "一级标签");
  const primaryCategories = ((primaryField?.property?.options ?? []) as Array<{ name: string }>).map((option) => option.name);
  if (!primaryCategories.length) throw new Error("primary_category_options_missing");

  const transcript = JSON.parse(await readFile(join(taskDir, "transcript", "whisper.json"), "utf8")) as {
    model?: string; language?: string; text?: string; segments?: unknown[];
  };
  if (!transcript.text?.trim()) throw new Error("whisper_transcript_missing");
  const processingMetadata = JSON.parse(await readFile(join(taskDir, "metadata.json"), "utf8")) as any;
  const douyinSamplePath = join(root, "docs", "douyin-publish-time-sample-7666820150208875814.json");
  const douyinMetadata = JSON.parse(await readFile(douyinSamplePath, "utf8")) as any;
  const workId = String(fields["原文链接"] ?? "").match(/(?:\/video\/|[?&]modal_id=)(\d+)/)?.[1] ?? douyinMetadata.video_id ?? null;
  const input = {
    source_record_id: recordId,
    title: fields["标题"] ?? "",
    author: fields["作者"] ?? "",
    source_platform: fields["来源平台"] ?? "",
    source_url: fields["原文链接"] ?? "",
    work_id: workId,
    publish_date: isoDate(fields["作品发布日期"]),
    collection_time: isoDate(fields["收录日期"]),
    existing_primary_category: fields["一级标签"] ?? "",
    existing_secondary_category: fields["二级标签"] ?? "",
    primary_category_options: primaryCategories,
    user_notes: fields["备注"] ?? "",
    whisper: {
      model: transcript.model ?? processingMetadata.whisper?.model ?? "",
      language: transcript.language ?? "",
      transcript: transcript.text,
      segment_count: Array.isArray(transcript.segments) ? transcript.segments.length : 0,
    },
    douyin_metadata: {
      video_id: douyinMetadata.video_id ?? workId,
      publish_time_field: douyinMetadata.publish_time_field ?? null,
      publish_time_raw_value: douyinMetadata.raw_value ?? null,
      publish_time_unit: douyinMetadata.unit ?? null,
      publish_time_asia_taipei: douyinMetadata.asia_taipei ?? null,
      media_duration_seconds: processingMetadata.durationSeconds ?? null,
    },
    required_provenance: {
      source_record_id: recordId,
      source_platform: String(fields["来源平台"] ?? ""),
      processor: "local-ai-analysis",
      model: config.summary.model,
      processor_version: "1.0.0",
    },
  };
  const plan = {
    mode: dryRun ? "dry-run" : "execute",
    recordId,
    baseStatus: fields["处理状态"],
    service: "DeepSeek OpenAI-compatible",
    model: config.summary.model,
    inputs: [join(taskDir, "transcript", "whisper.json"), join(taskDir, "metadata.json"), douyinSamplePath, "Base record + field options (read-only)"],
    outputs: paths,
    willCallModel: !dryRun,
    willModifyBase: false,
    willDownloadOrTranscribe: false,
  };
  console.log(JSON.stringify(plan, null, 2));
  if (dryRun) return;

  await mkdir(analysisDir, { recursive: true });
  await writeFile(paths.input, `${JSON.stringify(input, null, 2)}\n`, "utf8");
  const client = new OpenAICompatibleSummaryClient({
    baseUrl: config.summary.baseUrl, apiKey: config.summary.apiKey, model: config.summary.model,
  });
  const startedAt = Date.now();
  try {
    const raw = await client.completeJson(buildAnalysisSystemPrompt(primaryCategories), input);
    await writeFile(paths.rawResponse, raw, "utf8");
    const result = parseAndValidateAnalysis(raw, {
      recordId,
      platform: String(fields["来源平台"] ?? ""),
      model: config.summary.model,
      primaryCategories,
    });
    await writeFile(paths.result, `${JSON.stringify(result, null, 2)}\n`, "utf8");
    await writeFile(paths.validationLog, `${JSON.stringify({ valid: true, validatedAt: new Date().toISOString(), elapsedMs: Date.now() - startedAt, schema: "content-analysis-v1" })}\n`, "utf8");
    console.log(JSON.stringify({ success: true, elapsedMs: Date.now() - startedAt, summaryCharacters: result.summary.length, keyPointCount: result.key_points.length, correctionCount: result.transcript_corrections.length, outputs: paths }, null, 2));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await writeFile(paths.validationLog, `${JSON.stringify({ valid: false, failedAt: new Date().toISOString(), elapsedMs: Date.now() - startedAt, error: message })}\n`, "utf8");
    throw error;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
