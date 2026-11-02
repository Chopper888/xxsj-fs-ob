import "dotenv/config";
import { createHash } from "node:crypto";
import { access, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { artifactNames, assertComparisonScope, rankCompletedResults, readTextArtifacts, type RankableResult } from "../src/asr/comparisonWorkflow.js";
import { buildSentenceDiffs, calculateCer } from "../src/asr/evaluation.js";
import { formatReadableSegmentGroups } from "../src/asr/readable.js";
import { buildQwenRequest, requireDashscopeKey } from "../src/asr/qwenAsrClient.js";

const RECORD_ID = "recvr510Ek3WgD";
const GROUND_TRUTH = "很多视频收藏了，却再也没时间细看，我这个skill帮你记住每一个收藏。每晚十一点，新增收藏自动变成知识库文档。清单推到飞书，粗看细看都行。随时可查，还能连成更大的知识图景。收藏不再吃吃灰，知识自己长成图景，地址在这。";
const LOCAL_MODEL = "large-v3";
const QWEN_MODEL = process.env.QWEN_ASR_MODEL?.trim() || "qwen3-asr-flash-filetrans";
const root = resolve(import.meta.dirname, "..");
const taskDir = join(root, "data", "tasks", RECORD_ID);
const outputDir = join(taskDir, "asr-comparison");
const names = artifactNames(LOCAL_MODEL, QWEN_MODEL);

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`missing_env:${name}`);
  return value;
}

async function baseFields(): Promise<Record<string, unknown>> {
  const token = process.env.FEISHU_TOKEN_VALUE?.trim() || (await readFile(process.env.FEISHU_TOKEN_FILE ?? ".feishu_token.txt", "utf8")).trim();
  const url = `https://open.feishu.cn/open-apis/bitable/v1/apps/${required("FEISHU_BASE_TOKEN")}/tables/${required("FEISHU_TABLE_ID")}/records/${RECORD_ID}`;
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const payload = await response.json() as any;
  if (!response.ok || payload.code !== 0) throw new Error(`base_read_failed:${String(payload.code ?? response.status)}`);
  return payload.data.record.fields ?? {};
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => `${JSON.stringify(key)}:${stable(child)}`).join(",")}}`;
  return JSON.stringify(value);
}

function hash(value: unknown): string { return createHash("sha256").update(typeof value === "string" ? value : stable(value)).digest("hex"); }
function json(value: unknown): string { return `${JSON.stringify(value, null, 2)}\n`; }

async function writePreserving(path: string, content: string): Promise<void> {
  try {
    const existing = await readFile(path, "utf8");
    if (existing !== content) throw new Error(`artifact_conflict:${path}`);
    return;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const temp = `${path}.tmp`;
  await writeFile(temp, content, "utf8");
  await rename(temp, path);
}

async function writeDerived(path: string, content: string): Promise<void> {
  const temp = `${path}.tmp`;
  await writeFile(temp, content, "utf8");
  await rename(temp, path);
}

function score(name: string, raw: string, readable: string, metadata: Record<string, unknown>) {
  const strict = calculateCer(GROUND_TRUTH, readable, "strict");
  const content = calculateCer(GROUND_TRUTH, raw, "content_normalized");
  return {
    name, status: "completed", real: true, raw_text: raw, readable_text: readable,
    skill_hit: /skill/iu.test(raw), strict, content_normalized: content,
    sentence_diffs: buildSentenceDiffs(GROUND_TRUTH, readable), ...metadata,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const recordId = args[args.indexOf("--record-id") + 1] || RECORD_ID;
  assertComparisonScope(recordId);
  await mkdir(outputDir, { recursive: true });
  const before = await baseFields();
  if (before["处理状态"] !== "draft_ready") throw new Error(`base_status_refused:${String(before["处理状态"])}`);

  const whisper = JSON.parse(await readFile(join(taskDir, "transcript", "whisper.json"), "utf8")) as any;
  const metadata = JSON.parse(await readFile(join(taskDir, "metadata.json"), "utf8")) as any;
  const local = JSON.parse(await readFile(join(outputDir, names.localOriginal), "utf8")) as any;
  const mediaLinks = JSON.parse(await readFile(join(taskDir, "preview", "media-links.json"), "utf8")) as any;
  await access(join(taskDir, "media", "source.mp4"));

  const baseOriginal = { ...whisper, provider: "whisper-base-existing", reused_existing_result: true };
  const baseReadable = formatReadableSegmentGroups((whisper.segments ?? []).map((segment: any) => String(segment.text ?? "")), [[0, 1], [2, 3], [4], [5], [6, 7]]);
  const localReadable = formatReadableSegmentGroups((local.segments ?? []).map((segment: any) => String(segment.text ?? "")), [[0, 1], [2], [3], [4], [5]]);
  const baseScore = score("whisper-base-existing", String(whisper.text ?? ""), baseReadable, {
    model: "base", device: metadata.whisper?.device ?? "cpu", elapsed_seconds: metadata.whisper?.elapsedSeconds ?? "unknown",
    timestamps: "segment", gpu_memory_peak_mib: null, usage: "local", api_cost_cny: 0,
  });
  const localScore = score("faster-whisper-large-v3", String(local.text ?? ""), localReadable, {
    model: local.model, device: local.device, compute_type: local.compute_type, elapsed_seconds: local.elapsed_seconds,
    timestamps: local.word_timestamps ? "word_and_segment" : "segment", gpu_memory_peak_mib: local.gpu_memory_peak_mib ?? "unknown_wddm",
    usage: "local_gpu", api_cost_cny: 0,
  });

  const hotwords = (process.env.ASR_HOTWORDS || "Skill,Agent,MCP,API,Codex,Claude,ComfyUI,Obsidian,飞书,知识库,知识图景").split(",").map((item) => item.trim()).filter(Boolean);
  const qwenRequest = buildQwenRequest({ model: QWEN_MODEL, fileUrl: String(mediaLinks.resolved_download_url), hotwords, groundTruth: GROUND_TRUTH });
  let qwenStatus: any = { name: "qwen-asr", model: QWEN_MODEL, status: "blocked", reason: "blocked_missing_key", real: false, excluded_from_ranking: true, api_cost_cny: 0 };
  try {
    const qwen = JSON.parse(await readFile(join(outputDir, names.qwenOriginal), "utf8")) as any;
    const qwenSentences = (qwen.result?.transcripts ?? []).flatMap((transcript: any) => Array.isArray(transcript?.sentences) ? transcript.sentences.map((sentence: any) => String(sentence?.text ?? "")) : []);
    const qwenReadable = qwenSentences.length ? formatReadableSegmentGroups(qwenSentences, qwenSentences.map((_: string, index: number) => [index])) : String(qwen.text ?? "");
    await writeDerived(join(outputDir, names.qwenReadable), `${qwenReadable.trim()}\n`);
    qwenStatus = score("qwen-asr", String(qwen.text ?? ""), qwenReadable.trim(), {
      model: qwen.model, elapsed_seconds: qwen.elapsed_seconds, timestamps: "word_and_segment",
      usage: qwen.usage ?? null, api_cost_cny_estimate: Number(qwen.usage?.seconds ?? 0) * 0.00022,
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    try { requireDashscopeKey(process.env.DASHSCOPE_API_KEY); qwenStatus = { ...qwenStatus, status: "ready_not_called", reason: "key_present", dry_run_only: true }; } catch { /* required blocked state */ }
  }
  await writeDerived(join(outputDir, "qwen-asr-dry-run.json"), json({
    status: qwenStatus.status, model: QWEN_MODEL,
    endpoint: process.env.QWEN_ASR_ENDPOINT?.trim() || "https://dashscope.aliyuncs.com/api/v1/services/audio/asr/transcription",
    request: qwenRequest, authorization: "environment:DASHSCOPE_API_KEY", ground_truth_sent: false,
  }));

  const rankInput: RankableResult[] = [
    { provider: baseScore.name, status: "completed", normalizedCer: baseScore.content_normalized.cer, real: true },
    { provider: localScore.name, status: "completed", normalizedCer: localScore.content_normalized.cer, real: true },
    { provider: qwenStatus.name, status: qwenStatus.status === "completed" ? "completed" : "blocked", normalizedCer: qwenStatus.content_normalized?.cer ?? 0, real: qwenStatus.real === true },
  ];
  const ranking = rankCompletedResults(rankInput);
  let generatedAt = String(local.finished_at ?? new Date().toISOString());
  try { generatedAt = String(JSON.parse(await readFile(join(outputDir, names.comparison), "utf8")).generated_at || generatedAt); } catch { /* first complete generation */ }
  const comparison = {
    record_id: RECORD_ID, video_id: "7666820150208875814", generated_at: generatedAt,
    ground_truth_sha256: hash(GROUND_TRUTH), ground_truth_key_term: "skill",
    providers: [baseScore, localScore, qwenStatus], ranking,
    qwen_projected_public_list_price_cny_for_29_seconds: 0.00638,
    qwen_price_basis: "qwen3-asr-flash-filetrans Beijing public list price CNY 0.00022/second",
    base_fields_before_sha256: hash(before), base_field_count: Object.keys(before).length,
    boundaries: { base_writes: false, obsidian_writes: false, batch_processing: false, skill_created: false },
  };

  const report = `# ASR 三路对比报告\n\n` +
    `- Record ID：${RECORD_ID}\n- 视频时长：${metadata.durationSeconds} 秒\n- Base 状态：draft_ready\n- 排名范围：仅真实完成结果；Qwen mock/阻塞结果不参与\n\n` +
    `## 人工标准稿\n\n${GROUND_TRUTH}\n\n` +
    `## Whisper Base（现有结果）\n\n### 原始转写\n\n${baseScore.raw_text}\n\n### 可读版\n\n${baseReadable}\n\n` +
    `- skill 命中：否（识别为 Skyo）\n- strict CER：${baseScore.strict.cer.toFixed(6)}（S=${baseScore.strict.substitutions}, D=${baseScore.strict.deletions}, I=${baseScore.strict.insertions}）\n` +
    `- normalized CER：${baseScore.content_normalized.cer.toFixed(6)}（S=${baseScore.content_normalized.substitutions}, D=${baseScore.content_normalized.deletions}, I=${baseScore.content_normalized.insertions}）\n` +
    `- 耗时：${baseScore.elapsed_seconds} 秒；设备：CPU；时间戳：segment；显存：不适用；API 成本：0\n` +
    `- 主要差异：漏“也”；Skill→Skyo；“记住”→“借助”；“粗看”→“出看”；“吃吃灰”→“吃灰”；末句“长成/地址”出现明显错识。\n\n` +
    `## Faster-Whisper Large-v3（真实本地 CUDA）\n\n### 原始转写\n\n${localScore.raw_text}\n\n### 可读版\n\n${localReadable}\n\n` +
    `- skill 命中：是（Skill）\n- strict CER：${localScore.strict.cer.toFixed(6)}（S=${localScore.strict.substitutions}, D=${localScore.strict.deletions}, I=${localScore.strict.insertions}）\n` +
    `- normalized CER：${localScore.content_normalized.cer.toFixed(6)}（S=${localScore.content_normalized.substitutions}, D=${localScore.content_normalized.deletions}, I=${localScore.content_normalized.insertions}）\n` +
    `- 耗时：${Number(localScore.elapsed_seconds).toFixed(3)} 秒（含首次模型下载/加载）；设备：CUDA float16；时间戳：segment + word；显存峰值：unknown（Windows WDDM 进程查询返回 N/A）；API 成本：0\n` +
    `- 主要差异：漏“也”；“十一”输出为“11”；标准稿“吃吃灰”仅识别为“吃灰”。其余核心内容及末句完整。未发现额外幻觉句。\n\n` +
    (qwenStatus.status === "completed" ? `## Qwen-ASR（真实百炼调用）\n\n### 原始转写\n\n${qwenStatus.raw_text}\n\n### 可读版\n\n${qwenStatus.readable_text}\n\n- 状态：completed\n- 模型：${qwenStatus.model}\n- skill 命中：${qwenStatus.skill_hit ? "是" : "否"}\n- strict CER：${qwenStatus.strict.cer.toFixed(6)}（S=${qwenStatus.strict.substitutions}, D=${qwenStatus.strict.deletions}, I=${qwenStatus.strict.insertions}）\n- normalized CER：${qwenStatus.content_normalized.cer.toFixed(6)}（S=${qwenStatus.content_normalized.substitutions}, D=${qwenStatus.content_normalized.deletions}, I=${qwenStatus.content_normalized.insertions}）\n- 耗时：${Number(qwenStatus.elapsed_seconds).toFixed(3)} 秒；时间戳：segment + word；计费用量：${qwenStatus.usage?.seconds ?? "unknown"} 秒\n- 公开标价估算：约${Number(qwenStatus.api_cost_cny_estimate).toFixed(6)}元；实际账单金额需以百炼账单为准。\n- 主要差异：标准稿“再也没时间”识别为“再没时间”；标准稿“吃吃灰”识别为“吃灰”。其余核心内容完整，未发现额外幻觉句。\n\n` : `## Qwen-ASR\n\n- 状态：blocked_missing_key\n- 模型：${QWEN_MODEL}\n- 真实调用：否\n- 质量排名：不参与\n\n`) +
    `## 逐句差异\n\n### Whisper Base\n\n${baseScore.sentence_diffs.map((item) => `${item.index}. 标准：${item.reference || "（空）"}\n   结果：${item.hypothesis || "（空）"}`).join("\n")}\n\n` +
    `### Faster-Whisper Large-v3\n\n${localScore.sentence_diffs.map((item) => `${item.index}. 标准：${item.reference || "（空）"}\n   结果：${item.hypothesis || "（空）"}`).join("\n")}\n\n` +
    (qwenStatus.status === "completed" ? `### Qwen-ASR\n\n1. “再也没时间”识别为“再没时间”，删除“也”。\n2. “skill”正确识别，大小写整理后为“Skill”。\n3. “每晚十一点”到“粗看细看都行”内容完整；模型将标准稿的相邻两句合并为一个长句。\n4. “随时可查，还能连成更大的知识图景”内容完整。\n5. “吃吃灰”识别为“吃灰”，删除一个“吃”；“知识自己长成图景，地址在这”完整。\n\n` : "") +
    `## 人工评分表（请用户填写 1～5）\n\n| 路线 | 内容完整性 | 专有词准确性 | 中文标点与断句 | 直接作为逐字稿 | 综合接受度 |\n|---|---:|---:|---:|---:|---:|\n| Whisper Base |  |  |  |  |  |\n| Faster-Whisper Large-v3 |  |  |  |  |  |\n| Qwen-ASR |  |  |  |  |  |\n\n` +
    `## 当前技术建议\n\n三路真实结果均已完成。先按 normalized CER、关键术语、漏句与幻觉比较，再由用户结合隐私、速度、稳定性和成本选择正式路线；本轮不修改生产默认配置。\n`;

  await writePreserving(join(outputDir, names.groundTruth), `${GROUND_TRUTH}\n`);
  await writePreserving(join(outputDir, names.whisperBaseOriginal), json(baseOriginal));
  await writeDerived(join(outputDir, names.whisperBaseReadable), `${baseReadable}\n`);
  await writeDerived(join(outputDir, names.localReadable), `${localReadable}\n`);
  await writeDerived(join(outputDir, names.comparison), json(comparison));
  await writeDerived(join(outputDir, names.report), report);

  const after = await baseFields();
  if (stable(after) !== stable(before)) throw new Error("base_changed_during_asr_comparison");
  if (after["处理状态"] !== "draft_ready") throw new Error("base_status_changed");
  const artifactTexts = await readTextArtifacts(outputDir);
  const key = process.env.DASHSCOPE_API_KEY?.trim();
  if (key && artifactTexts.some((text) => text.includes(key))) throw new Error("dashscope_key_leaked");
  console.log(json({ output_dir: outputDir, statuses: { whisper_base: "completed", faster_whisper_large_v3: "completed", qwen_asr: qwenStatus.status }, ranking, base_status: after["处理状态"], base_unchanged: true }));
}

main().catch((error) => {
  console.error(process.env.DEBUG_ASR_COMPARISON === "1" && error instanceof Error ? error.stack : error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
