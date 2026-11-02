import "dotenv/config";
import { readFile, writeFile, mkdir, rename, unlink, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { LarkCliAdapter } from "../src/base/larkCliAdapter.js";
import {
  tryAcquireLock, releaseLock, readLock, saveStage, readStage, resolveMediaUrlForAsr, validateRecordId, validateBaseFields,
  mediaExists, asrRawExists, analysisCacheExists,
  determineResumeStage, sha256, type ProcessStage,
  readTaskRetryCount, bumpTaskRetryCount,
} from "../src/worker/autoWorker.js";
import { createDouyinWorkerPlatformBridge } from "../src/platform/douyin/workerPlatformBridge.js";
import { PlatformAdapterError } from "../src/platform/platformAdapter.js";
import { createProductionAdapterRegistry } from "../src/platform/productionRegistry.js";
import { runWechatProductionPipeline } from "../src/worker/wechatProductionPipeline.js";
import { runBilibiliProductionPipeline } from "../src/worker/bilibiliProductionPipeline.js";
import { runXProductionPipeline } from "../src/worker/xProductionPipeline.js";
import { runYouTubeProductionPipeline } from "../src/worker/youtubeProductionPipeline.js";
import { runDouyinNoteProductionPipeline } from "../src/worker/douyinNoteProductionPipeline.js";
import { isDouyinNoteOrArticleUrl } from "../src/platform/douyin/douyinNoteContent.js";
import { buildYouTubeYtDlpConfigFromEnv } from "../src/platform/youtube/youtubeYtDlp.js";
import { materializeWechatImages, persistWechatAssetsToVault } from "../src/platform/wechat/wechatAssetMaterializer.js";
import { materializeXVideoMedia } from "../src/platform/x/xVideoResolver.js";
import { writeMarkdownAtomically } from "../src/obsidian/noteWriter.js";
import { toAnalysisInput } from "../src/platform/contentPreparation.js";
import { buildDouyinAnalysisRequest } from "../src/analysis/analysisRequest.js";
import { transcribeWithFallback } from "../src/asr/asrOrchestrator.js";
import { buildOrchestratorConfigFromEnv } from "../src/asr/providers.js";
import { parseAndValidateAnalysis, buildAnalysisSystemPrompt, buildArticleAnalysisSystemPrompt, buildVideoAnalysisSystemPrompt, buildSocialPostAnalysisSystemPrompt, buildYouTubeVideoAnalysisSystemPrompt } from "../src/analysis/contentAnalysis.js";
import { OpenAICompatibleSummaryClient } from "../src/summary/openaiCompatibleClient.js";
import { loadConfigFromEnv } from "../src/config.js";
import { isRetryEligible, prepareAttemptFields, selectRunnableRecordIds, shouldContinuePolling } from "../src/worker/workerLifecycle.js";
import { createInitialWorkerStatus, maskRecordId, writeWorkerStatus, type WorkerStatus } from "../src/worker/workerStatus.js";
import { runPostTaskCleanup } from "../src/worker/storageCleanup.js";
import { resolveRuntimePaths } from "../src/config/runtimePaths.js";

const root = resolve(import.meta.dirname, "..");
const BASE_TOKEN = process.env.FEISHU_BASE_TOKEN!;
const TABLE_ID = process.env.FEISHU_TABLE_ID!;
const ILLEGAL = /[<>:"/\\|?*]/g;
let runtimeStatus: WorkerStatus | null = null;

async function publishStatus(patch: Partial<WorkerStatus>): Promise<void> {
  if (!runtimeStatus) return;
  runtimeStatus = { ...runtimeStatus, ...patch };
  await writeWorkerStatus(root, runtimeStatus);
}

async function queueSnapshot(records: Array<{ record_id: string; fields: Record<string, unknown> }>) {
  const count = (status: string) => records.filter(record => String(record.fields["处理状态"] ?? "") === status).length;
  const retryEligibleFlags = await Promise.all(records.map(async record =>
    String(record.fields["处理状态"] ?? "") === "failed" && isRetryEligible(record.fields, await readTaskRetryCount(root, record.record_id)),
  ));
  return {
    pending: count("pending"), processing: count("processing"), draft_ready: count("draft_ready"), failed: count("failed"),
    retry_eligible: retryEligibleFlags.filter(Boolean).length,
  };
}

// --- CLI args ---
function parseArgs(argv: string[]) {
  const v = (f: string) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };
  return {
    recordIds: (v("--record-ids") ?? "").split(",").map(s => s.trim()).filter(Boolean),
    maxTasks: Number(v("--max-tasks") ?? "4"),
    runOnce: argv.includes("--run-once"),
    idleTimeoutMs: Number(v("--idle-timeout-seconds") ?? "180") * 1000,
    pollIntervalMs: Number(v("--poll-interval-seconds") ?? "10") * 1000,
    faultAfterStage: v("--fault-after-stage") as ProcessStage | undefined,
  };
}

const larkAdapter = new LarkCliAdapter(process.env.FEISHU_BASE_TOKEN!, process.env.FEISHU_TABLE_ID!, "data");
const platformBridge = createDouyinWorkerPlatformBridge({ root });
const platformRegistry = createProductionAdapterRegistry({ projectRoot: root });

async function baseApi(path: string, method = "GET", body?: unknown): Promise<any> {
  if (method === "GET") {
    if (path.startsWith("/records/") && !path.includes("?")) {
      return larkAdapter.recordGet(path.split("/").pop()!);
    }
    return { items: larkAdapter.recordList() };
  }
  if (method === "PUT" && path.startsWith("/records/")) {
    await larkAdapter.recordUpsert(path.split("/").pop()!, (body as any)?.fields ?? {});
    return { code: 0 };
  }
  throw new Error("unsupported:" + method + " " + path);
}

async function getRecord(recordId: string): Promise<Record<string, unknown>> {
  return (await baseApi("/records/" + recordId)).record.fields;
}

async function updateRecord(recordId: string, fields: Record<string, unknown>): Promise<void> {
  validateBaseFields(fields);
  await baseApi("/records/" + recordId, "PUT", { fields });
}

// 认领任务：失败重试时本地计数 +1（不写回飞书），再写认领字段。
async function beginAttempt(recordId: string, fields: Record<string, unknown>): Promise<void> {
  await bumpTaskRetryCount(root, recordId, String(fields["处理状态"] ?? ""));
  await updateRecord(recordId, prepareAttemptFields());
}

// --- Main processing ---
function sanitizeFilename(raw: string): string {
  return raw.replace(ILLEGAL, "-").replace(/\s+/g, " ").trim().slice(0, 160) || "untitled";
}

async function processTask(recordId: string, faultAfterStage?: ProcessStage) {
  validateRecordId(recordId);
  const workerId = randomUUID().slice(0, 8);
  const taskDir = join(root, "data", "tasks", recordId);

  const fields = await getRecord(recordId);
  const status = String(fields["处理状态"] ?? "?");
  const sourceUrl = String(fields["原文链接"] ?? "");
  const title = String(fields["标题"] ?? "");
  const platform = String(fields["来源平台"] ?? "抖音");
  const dedupeKey = String(fields["去重ID"] ?? "").trim() || undefined;
  const taskStartedAt = new Date().toISOString();

  const adapter = platformRegistry.resolve({ sourceUrl, declaredPlatform: platform, dedupeKey });
  if (status === "failed" && !isRetryEligible(fields, await readTaskRetryCount(root, recordId))) {
    console.log(`[${recordId.slice(-8)}] 跳过: failed不可自动重试`);
    return false;
  }
  if (!["pending", "draft_ready", "processing", "failed"].includes(status)) {
    console.log(`[${recordId.slice(-8)}] 跳过: 状态=${status}`);
    return false;
  }

  const setStage = async (stage: string, stageIndex: number) => publishStatus({ current_task: {
    record_id_masked: maskRecordId(recordId), platform, title: title.slice(0, 120), status: "processing",
    stage, stage_index: stageIndex, stage_total: 8, started_at: taskStartedAt,
  } });
  const platformContext = { taskDir, signal: new AbortController().signal, logger: { info: (message: string) => console.log(`[${recordId.slice(-8)}] ${message}`), warn: (message: string) => console.warn(`[${recordId.slice(-8)}] ${message}`) } };

  if (adapter.platform === "wechat_official_account") {
    const { obsidianVaultPath } = resolveRuntimePaths({}, process.env);
    await beginAttempt(recordId, fields);
    const result = await runWechatProductionPipeline({ recordId, taskDir, sourceUrl, declaredPlatform: platform, title, vaultPath: obsidianVaultPath }, {
      resolveContent: async () => { const normalized = await adapter.normalizeUrl({ sourceUrl, declaredPlatform: platform, dedupeKey }, platformContext); const identity = await adapter.resolveIdentity(normalized, platformContext); return adapter.resolveContent(identity, platformContext); },
      materializeMedia: async () => { throw new Error("wechat_media_materialization_forbidden"); }, transcribe: async () => { throw new Error("wechat_asr_forbidden"); },
      materializeImages: content => materializeWechatImages(content.media, { taskDir, articleUrl: content.identity.canonicalUrl }),
      persistImages: (content, assets) => persistWechatAssetsToVault(assets, { vaultPath: obsidianVaultPath, targetDir: join(process.env.OBSIDIAN_INBOX_DIR ?? "000-Inbox\\001-信息中心", "公众号"), dedupeKey: content.identity.dedupeKey }),
      analyze: async analysisInput => { const config = loadConfigFromEnv(process.env); const primaryCategories = ["AI Agent/编程", "Skill/插件/模型", "ComfyUI/AI绘画", "AI行业动态/资讯", "其他"]; const client = new OpenAICompatibleSummaryClient({ baseUrl: config.summary.baseUrl, apiKey: config.summary.apiKey, model: config.summary.model }); const payload = { ...analysisInput, source_record_id: recordId, source_platform: platform, required_provenance: { source_record_id: recordId, source_platform: platform, processor: "local-ai-analysis", model: config.summary.model, processor_version: "1.0.0" } }; const raw = await client.completeJson(buildArticleAnalysisSystemPrompt(primaryCategories), payload); return parseAndValidateAnalysis(raw, { recordId, platform, model: config.summary.model, primaryCategories }); },
      writeNote: note => writeMarkdownAtomically({ ...note, targetDir: join(process.env.OBSIDIAN_INBOX_DIR ?? "000-Inbox\\001-信息中心", "公众号"), naming: "title-workid" }),
      updateBase: update => updateRecord(recordId, update), setStage,
    });
    await saveStage(root, recordId, "done", JSON.stringify({ path: result.notePath, warnings: result.warnings })); await publishStatus({ current_task: null, last_completed: { title: title.slice(0, 120), finished_at: new Date().toISOString(), result: "done" }, last_error: null }); return true;
  }

  if (adapter.platform === "bilibili") {
    const { obsidianVaultPath } = resolveRuntimePaths({}, process.env);
    await beginAttempt(recordId, fields);
    const result = await runBilibiliProductionPipeline({ recordId, taskDir, sourceUrl, declaredPlatform: platform, title, vaultPath: obsidianVaultPath }, {
      resolveContent: async () => { const normalized=await adapter.normalizeUrl({sourceUrl,declaredPlatform:platform,dedupeKey},platformContext);const identity=await adapter.resolveIdentity(normalized,platformContext);return adapter.resolveContent(identity,platformContext); },
      materializeMedia: async content => { if(!adapter.materializeMedia)throw new Error("bilibili_media_materializer_missing");return adapter.materializeMedia(content,platformContext); },
      transcribe: async media => { const item=media[0];if(!item)throw new Error("bilibili_media_missing");const outputDir=join(taskDir,"transcript");const result=await transcribeWithFallback(buildOrchestratorConfigFromEnv(process.env),item.mediaUrl??item.localPath,item.localPath,outputDir);await mkdir(outputDir,{recursive:true});await writeFile(join(outputDir,"whisper.json"),JSON.stringify(result,null,2),"utf8");return{text:result.text,provider:result.provider,segments:result.segments}; },
      analyze: async (analysisInput,mode) => { const config=loadConfigFromEnv(process.env);const primaryCategories=["AI Agent/编程","Skill/插件/模型","ComfyUI/AI绘画","AI行业动态/资讯","其他"];const client=new OpenAICompatibleSummaryClient({baseUrl:config.summary.baseUrl,apiKey:config.summary.apiKey!,model:config.summary.model});const payload={...analysisInput,source_record_id:recordId,source_platform:platform,required_provenance:{source_record_id:recordId,source_platform:platform,processor:"local-ai-analysis",model:config.summary.model,processor_version:"1.0.0"}};const raw=await client.completeJson(buildVideoAnalysisSystemPrompt(primaryCategories,mode),payload);return parseAndValidateAnalysis(raw,{recordId,platform,model:config.summary.model,primaryCategories}); },
      writeNote: note => { const inbox=process.env.OBSIDIAN_INBOX_DIR??"000-Inbox\\001-信息中心";return writeMarkdownAtomically({...note,targetDir:join(inbox,"B站"),naming:"title-workid"}); },
      updateBase:update=>updateRecord(recordId,update),setStage,
    });
    await saveStage(root,recordId,"done",JSON.stringify({path:result.notePath,mode:result.preparationMode}));await publishStatus({current_task:null,last_completed:{title:title.slice(0,120),finished_at:new Date().toISOString(),result:"done"},last_error:null});return true;
  }

  if (adapter.platform === "x") {
    const { obsidianVaultPath } = resolveRuntimePaths({}, process.env);
    await beginAttempt(recordId, fields);
    const normalized = await adapter.normalizeUrl({ sourceUrl, declaredPlatform: platform, dedupeKey }, platformContext);
    const result = await runXProductionPipeline({ recordId, taskDir, sourceUrl: normalized.canonicalUrl, declaredPlatform: platform, title, vaultPath: obsidianVaultPath }, {
      resolveContent: async () => { const identity = await adapter.resolveIdentity(normalized, platformContext); return adapter.resolveContent(identity, platformContext); },
      materializeMedia: async content => {
        const video = content.media.find(m => m.kind === "video");
        if (!video?.sourceUrl) throw new Error("x_video_stream_missing");
        const stream = { url: video.sourceUrl, mimeType: (video.mimeType === "application/x-mpegURL" ? "application/x-mpegURL" : "video/mp4") };
        return [await materializeXVideoMedia({ taskDir, stream, referer: content.identity.canonicalUrl })];
      },
      transcribe: async media => {
        const item = media[0];
        if (!item) throw new Error("x_video_missing");
        const outputDir = join(taskDir, "transcript");
        // X: dashscope 无法直连 video.twimg.com 抓取（FILE_DOWNLOAD_FAILED），改传本地文件由 qwen-asr 以 data URI 上传
        const result = await transcribeWithFallback(buildOrchestratorConfigFromEnv(process.env), item.localPath, item.localPath, outputDir);
        await mkdir(outputDir, { recursive: true });
        await writeFile(join(outputDir, "whisper.json"), JSON.stringify(result, null, 2), "utf8");
        return { text: result.text, provider: result.provider, segments: result.segments };
      },
      materializeImages: content => materializeWechatImages(content.media, { taskDir, articleUrl: content.identity.canonicalUrl, magicBytes: true }),
      persistImages: (content, assets) => { const inbox = process.env.OBSIDIAN_INBOX_DIR ?? "000-Inbox\\001-信息中心"; return persistWechatAssetsToVault(assets, { vaultPath: obsidianVaultPath, targetDir: join(inbox, "推特"), dedupeKey: content.identity.dedupeKey }); },
      analyze: async analysisInput => { const config = loadConfigFromEnv(process.env); const primaryCategories = ["AI Agent/编程","Skill/插件/模型","ComfyUI/AI绘画","AI行业动态/资讯","其他"]; const client = new OpenAICompatibleSummaryClient({ baseUrl: config.summary.baseUrl, apiKey: config.summary.apiKey!, model: config.summary.model }); const prompt = buildSocialPostAnalysisSystemPrompt(primaryCategories); const payload = { ...analysisInput, source_record_id: recordId, source_platform: platform, required_provenance: { source_record_id: recordId, source_platform: platform, processor: "local-ai-analysis", model: config.summary.model, processor_version: "1.0.0" } }; const context = { recordId, platform, model: config.summary.model, primaryCategories }; for (let attempt = 1; ; attempt++) { try { return parseAndValidateAnalysis(await client.completeJson(prompt, payload), context); } catch (e) { if (attempt >= 2 || !(e instanceof Error) || !e.message.startsWith("analysis_schema_invalid:")) throw e; console.warn(`[${recordId.slice(-8)}] 分析 JSON 不合 schema，重试(${attempt}/2)...`); } } },
      writeNote: note => { const inbox = process.env.OBSIDIAN_INBOX_DIR ?? "000-Inbox\\001-信息中心"; return writeMarkdownAtomically({ ...note, targetDir: join(inbox, "推特"), naming: "title-workid" }); },
      updateBase: update => updateRecord(recordId, update), setStage,
    });
    await saveStage(root, recordId, "done", JSON.stringify({ path: result.notePath, mode: result.preparationMode })); await publishStatus({ current_task: null, last_completed: { title: title.slice(0, 120), finished_at: new Date().toISOString(), result: "done" }, last_error: null }); return true;
  }

  if (adapter.platform === "youtube") {
    const { obsidianVaultPath } = resolveRuntimePaths({}, process.env);
    await beginAttempt(recordId, fields);
    const ytConfig = buildYouTubeYtDlpConfigFromEnv(process.env);
    const result = await runYouTubeProductionPipeline({ recordId, taskDir, sourceUrl, declaredPlatform: platform, title, vaultPath: obsidianVaultPath }, {
      resolveContent: async () => { const normalized = await adapter.normalizeUrl({ sourceUrl, declaredPlatform: platform, dedupeKey }, platformContext); const identity = await adapter.resolveIdentity(normalized, platformContext); return adapter.resolveContent(identity, platformContext); },
      materializeMedia: async content => { if (!adapter.materializeMedia) throw new Error("youtube_media_materializer_missing"); return adapter.materializeMedia(content, platformContext); },
      transcribe: async media => { const item = media[0]; if (!item) throw new Error("youtube_media_missing"); const outputDir = join(taskDir, "transcript"); const result = await transcribeWithFallback(buildOrchestratorConfigFromEnv(process.env), item.localPath, item.localPath, outputDir); await mkdir(outputDir, { recursive: true }); await writeFile(join(outputDir, "whisper.json"), JSON.stringify(result, null, 2), "utf8"); return { text: result.text, provider: result.provider, segments: result.segments }; },
      analyze: async (analysisInput, mode) => { const config = loadConfigFromEnv(process.env); const primaryCategories = ["AI Agent/编程", "Skill/插件/模型", "ComfyUI/AI绘画", "AI行业动态/资讯", "其他"]; const client = new OpenAICompatibleSummaryClient({ baseUrl: config.summary.baseUrl, apiKey: config.summary.apiKey!, model: config.summary.model }); const payload = { ...analysisInput, source_record_id: recordId, source_platform: platform, required_provenance: { source_record_id: recordId, source_platform: platform, processor: "local-ai-analysis", model: config.summary.model, processor_version: "1.0.0" } }; const raw = await client.completeJson(buildYouTubeVideoAnalysisSystemPrompt(primaryCategories, mode), payload); return parseAndValidateAnalysis(raw, { recordId, platform, model: config.summary.model, primaryCategories }); },
      writeNote: note => { const inbox = process.env.OBSIDIAN_INBOX_DIR ?? "000-Inbox\\001-信息中心"; return writeMarkdownAtomically({ ...note, targetDir: join(inbox, "YouTube"), naming: "title-workid" }); },
      updateBase: update => updateRecord(recordId, update), setStage,
    });
    await saveStage(root, recordId, "done", JSON.stringify({ path: result.notePath, mode: result.preparationMode })); await publishStatus({ current_task: null, last_completed: { title: title.slice(0, 120), finished_at: new Date().toISOString(), result: "done" }, last_error: null }); return true;
  }

  if (adapter.platform === "douyin" && isDouyinNoteOrArticleUrl(sourceUrl)) {
    const { obsidianVaultPath } = resolveRuntimePaths({}, process.env);
    await beginAttempt(recordId, fields);
    const result = await runDouyinNoteProductionPipeline({ recordId, taskDir, sourceUrl, declaredPlatform: platform, title, vaultPath: obsidianVaultPath }, {
      resolveContent: async () => { const normalized = await adapter.normalizeUrl({ sourceUrl, declaredPlatform: platform, dedupeKey }, platformContext); const identity = await adapter.resolveIdentity(normalized, platformContext); return adapter.resolveContent(identity, platformContext); },
      materializeMedia: async () => { throw new Error("douyin_note_materialize_media_forbidden"); },
      transcribe: async () => { throw new Error("douyin_note_asr_forbidden"); },
      materializeImages: content => materializeWechatImages(content.media, { taskDir, articleUrl: content.identity.canonicalUrl, magicBytes: true }),
      persistImages: (content, assets) => { const inbox = process.env.OBSIDIAN_INBOX_DIR ?? "000-Inbox\\001-信息中心"; return persistWechatAssetsToVault(assets, { vaultPath: obsidianVaultPath, targetDir: join(inbox, "抖音"), dedupeKey: content.identity.dedupeKey }); },
      analyze: async analysisInput => { const config = loadConfigFromEnv(process.env); const primaryCategories = ["AI Agent/编程", "Skill/插件/模型", "ComfyUI/AI绘画", "AI行业动态/资讯", "其他"]; const client = new OpenAICompatibleSummaryClient({ baseUrl: config.summary.baseUrl, apiKey: config.summary.apiKey!, model: config.summary.model }); const payload = { ...analysisInput, source_record_id: recordId, source_platform: platform, required_provenance: { source_record_id: recordId, source_platform: platform, processor: "local-ai-analysis", model: config.summary.model, processor_version: "1.0.0" } }; const raw = await client.completeJson(buildArticleAnalysisSystemPrompt(primaryCategories), payload); return parseAndValidateAnalysis(raw, { recordId, platform, model: config.summary.model, primaryCategories }); },
      writeNote: note => { const inbox = process.env.OBSIDIAN_INBOX_DIR ?? "000-Inbox\\001-信息中心"; return writeMarkdownAtomically({ ...note, targetDir: join(inbox, "抖音"), naming: "title-workid" }); },
      updateBase: update => updateRecord(recordId, update), setStage,
    });
    await saveStage(root, recordId, "done", JSON.stringify({ path: result.notePath, warnings: result.warnings })); await publishStatus({ current_task: null, last_completed: { title: title.slice(0, 120), finished_at: new Date().toISOString(), result: "done" }, last_error: null }); return true;
  }

  const saved = await readStage(root, recordId);
  const products = {
    media: await mediaExists(root, recordId),
    asr: await asrRawExists(root, recordId),
    analysis: await analysisCacheExists(root, recordId),
  };
  const resume = determineResumeStage(saved?.stage ?? "pending", products);
  console.log(`[${recordId.slice(-8)}] 开始: w=${workerId} resume=${resume.startFrom} skipDl=${resume.skipDownload} skipQwen=${resume.skipQwen} skipDS=${resume.skipDeepSeek}`);

  if (resume.startFrom === "done") { console.log(`[${recordId.slice(-8)}] 已完成,跳过`); return false; }

  // Claim
  await setStage("claim", 1);
  await beginAttempt(recordId, fields);
  await saveStage(root, recordId, "claimed");
  await setStage("metadata", 2);

  // Media download
  if (!resume.skipDownload) {
    await setStage("download", 3);
    console.log(`[${recordId.slice(-8)}] 下载媒体...`);
    const mediaPath = join(root, "data", "tasks", recordId, "media", "source.mp4");
    await mkdir(join(taskDir, "media"), { recursive: true });
    const resolved = await platformBridge.resolveAndMaterialize({ sourceUrl, declaredPlatform: platform, dedupeKey, taskDir });
    const media = { resolvedUrl: resolved.media.mediaUrl ?? "", bytes: resolved.media.bytes ?? 0 };
    await writeFile(join(taskDir, "metadata.json"), JSON.stringify({
      sourceUrl, resolvedUrl: media.resolvedUrl, bytes: media.bytes, downloadedAt: new Date().toISOString(),
    }, null, 2), "utf8");
    console.log(`[${recordId.slice(-8)}] 下载完成: ${(media.bytes / 1024 / 1024).toFixed(1)}MB`);
  }
  await saveStage(root, recordId, "media_downloaded");
  if (faultAfterStage === "media_downloaded") { console.log("FAULT after media_downloaded"); process.exit(0); }

  // Qwen ASR
  if (!resume.skipQwen) {
    await setStage("asr", 4);
    console.log(`[${recordId.slice(-8)}] Qwen-ASR...`);
    const mediaPath = join(root, "data", "tasks", recordId, "media", "source.mp4");
    const transcriptDir = join(taskDir, "transcript");
    await mkdir(transcriptDir, { recursive: true });
    const asrConfig = buildOrchestratorConfigFromEnv(process.env);
    let metadata: any = {};
    try { metadata = JSON.parse(await readFile(join(taskDir, "metadata.json"), "utf8")); } catch {}
    const mediaUrl = resolveMediaUrlForAsr({
      resolvedUrl: metadata.resolvedUrl, sourceUrl, mediaPath,
    });
    const asrResult = await transcribeWithFallback(asrConfig, mediaUrl.url, mediaPath, transcriptDir);
    await writeFile(join(transcriptDir, "whisper.json"), JSON.stringify({
      provider: asrResult.provider, model: asrResult.model,
      text: asrResult.text, segments: asrResult.segments,
      elapsed_seconds: asrResult.elapsed_seconds, retries: asrResult.retries,
      fallback: asrResult.fallback ?? null,
    }, null, 2) + "\n", "utf8");
    console.log(`[${recordId.slice(-8)}] ASR: ${asrResult.provider} ${asrResult.text.length}字 ${asrResult.elapsed_seconds.toFixed(1)}s${asrResult.fallback ? " FALLBACK" : ""}`);
  } else { console.log(`[${recordId.slice(-8)}] 复用ASR`); }
  await saveStage(root, recordId, "asr_completed");
  if (faultAfterStage === "asr_completed") { console.log("FAULT after asr_completed"); await updateRecord(recordId, { "处理状态": "draft_ready", "备注": "fault:asr_completed" }); process.exit(0); }

  // DeepSeek
  if (!resume.skipDeepSeek) {
    await setStage("deepseek", 5);
    console.log(`[${recordId.slice(-8)}] DeepSeek...`);
    const asr = JSON.parse(await readFile(join(taskDir, "transcript", "whisper.json"), "utf8"));
    let primaryCategories: string[] = ["AI Agent/编程", "Skill/插件/模型", "ComfyUI/AI绘画", "AI行业动态/资讯", "其他"];

    const config = loadConfigFromEnv(process.env);
    const normalized = await adapter.normalizeUrl({ sourceUrl, declaredPlatform: platform, dedupeKey }, platformContext); const identity = await adapter.resolveIdentity(normalized, platformContext); const source = { ...(await adapter.resolveContent(identity, platformContext)), title }; const analysisInput = toAnalysisInput(recordId, { source, texts: [{ origin: "asr", role: "primary", text: asr.text, provider: asr.provider }], primaryText: asr.text, transcript: { text: asr.text, provider: asr.provider, segments: asr.segments }, preparationMode: "media-first" });
    const input = buildDouyinAnalysisRequest(analysisInput, { sourcePlatform: platform, sourceUrl, model: config.summary.model, segmentCount: asr.segments?.length ?? 0 });
    const client = new OpenAICompatibleSummaryClient({ baseUrl: config.summary.baseUrl, apiKey: config.summary.apiKey, model: config.summary.model });
    const raw = await client.completeJson(buildAnalysisSystemPrompt(primaryCategories), input);
    const result = parseAndValidateAnalysis(raw, { recordId, platform, model: config.summary.model, primaryCategories });
    const analysisDir = join(taskDir, "analysis");
    await mkdir(analysisDir, { recursive: true });
    await writeFile(join(analysisDir, "result.json"), JSON.stringify(result, null, 2) + "\n", "utf8");
    console.log(`[${recordId.slice(-8)}] DeepSeek: ${result.summary.length}字摘要 ${result.key_points.length}关键点`);
  } else { console.log(`[${recordId.slice(-8)}] 复用DeepSeek`); }
  await saveStage(root, recordId, "analysis_completed");
  if (faultAfterStage === "analysis_completed") { console.log("FAULT after analysis_completed"); process.exit(0); }

  // Markdown + Obsidian
  await setStage("markdown", 6);
  const analysis = JSON.parse(await readFile(join(taskDir, "analysis", "result.json"), "utf8"));
  const asr = JSON.parse(await readFile(join(taskDir, "transcript", "whisper.json"), "utf8"));
  const workId = sourceUrl.match(/(?:\/video\/|[?&]modal_id=)(\d+)/)?.[1] ?? recordId;
  const now = new Date();
  const shanghai = new Date(now.getTime() + 8 * 3600000).toISOString().replace("Z", "+08:00");

  let md = "---\n";
  md += `platform: ${platform}\n`;
  md += `author: ${String(fields["作者"] ?? "")}\n`;
  md += `source_url: ${sourceUrl}\n`;
  md += `work_id: ${workId}\n`;
  md += `processed_at: ${shanghai}\n`;
  md += `base_record_id: ${recordId}\n`;
  md += `transcriber: ${asr.provider}\n`;
  md += "analyzer: deepseek-chat\n";
  md += `primary_category: ${analysis.primary_category || ""}\n`;
  md += `secondary_category: ${analysis.secondary_category || ""}\n`;
  md += "---\n\n";
  md += `# ${title}\n\n`;
  md += "## 摘要\n\n" + (analysis.summary || "") + "\n\n";
  if (analysis.key_points?.length) { md += "## 关键信息点\n\n"; for (const kp of analysis.key_points) md += "- " + kp + "\n"; md += "\n"; }
  md += "## 逐字稿\n\n" + (asr.text || "") + "\n\n";
  md += `> 逐字稿来源：${asr.provider} 可读化结果，未经人工校正\n\n`;
  if (analysis.useful_information?.length) { md += "## 值得保存的信息\n\n"; for (const item of analysis.useful_information) md += "- " + item + "\n"; md += "\n"; }
  md += `---\n\n*自动生成于 ${shanghai}*\n`;

  const mHash = sha256(md);
  await saveStage(root, recordId, "markdown_ready", mHash);

  // Obsidian write
  await setStage("obsidian", 7);
  const { obsidianVaultPath } = resolveRuntimePaths({}, process.env);
  const vaultDir = join(obsidianVaultPath, process.env.OBSIDIAN_INBOX_DIR ?? "000-Inbox\\001-信息中心", platform);
  await mkdir(vaultDir, { recursive: true });
  const fn = `${sanitizeFilename(title)} - ${workId}.md`;
  const obsPath = join(vaultDir, fn);

  let existing: string | null = null;
  try { existing = await readFile(obsPath, "utf8"); } catch {}
  if (existing && sha256(existing) === mHash) {
    console.log(`[${recordId.slice(-8)}] Obsidian 相同内容, 跳过写入`);
  } else if (existing) {
    console.log(`[${recordId.slice(-8)}] Obsidian 存在不同内容(用户修改), 跳过覆盖`);
  } else {
    const tmp = obsPath + ".tmp." + Date.now();
    await writeFile(tmp, md, "utf8");
    await rename(tmp, obsPath);
    console.log(`[${recordId.slice(-8)}] Obsidian: ${obsPath}`);
  }

  await saveStage(root, recordId, "obsidian_written");
  if (faultAfterStage === "obsidian_written") { console.log("FAULT after obsidian_written"); process.exit(0); }

  // Base done
  await setStage("base_done", 8);
  await updateRecord(recordId, { "处理状态": "done", "知识库路径": obsPath, "处理时间": Date.now() });
  const confirm = await getRecord(recordId);
  console.log(`[${recordId.slice(-8)}] Base done, SHA-256: ${mHash.slice(0, 16)}`);
  await saveStage(root, recordId, "done");
  await publishStatus({ current_task: null, last_completed: { title: title.slice(0, 120), finished_at: new Date().toISOString(), result: "done" }, last_error: null });
  return true;
}

// --- Main ---
async function main() {
  const args = parseArgs(process.argv.slice(2));
  const vaultPath = process.env.OBSIDIAN_VAULT_PATH?.trim();
  if (!vaultPath) {
    console.error("[config] 未配置 OBSIDIAN_VAULT_PATH。");
    console.error("         请在项目根目录的 .env 中填写 Obsidian vault 的绝对路径，例如：");
    console.error("         OBSIDIAN_VAULT_PATH=D:\\Obsidian\\MyVault");
    console.error("         保存后重新启动 Worker。运行 scripts/doctor.ps1 也可检查此项。");
    process.exit(1);
  }
  console.log(`Worker: ids=${args.recordIds.join(",")} maxTasks=${args.maxTasks} runOnce=${args.runOnce} fault=${args.faultAfterStage || "none"}`);
  console.log(`Worker: vault=${vaultPath} inbox=${process.env.OBSIDIAN_INBOX_DIR ?? "000-Inbox\\001-信息中心"}`);
  console.log(`Worker: proxy=${process.env.HTTPS_PROXY ?? "(未设置)"} identity=${process.env.LARK_IDENTITY ?? "bot"}`);

  if (!(await tryAcquireLock(root, "auto-worker"))) { console.error("Worker已在运行"); process.exit(1); }
  const lock = await readLock(root);
  const lockToken = String(lock?.token ?? "");
  if (!lockToken) throw new Error("worker_lock_token_missing");
  runtimeStatus = createInitialWorkerStatus(process.pid, args.pollIntervalMs / 1000);
  await writeWorkerStatus(root, runtimeStatus);
  const heartbeat = setInterval(() => {
    void publishStatus({ last_heartbeat_at: new Date().toISOString() }).catch(() => undefined);
  }, 5000);

  let shouldStop = false;
  process.on("SIGINT", () => { shouldStop = true; console.log("\nSIGINT, 优雅停止..."); });
  process.on("SIGTERM", () => { shouldStop = true; });

  const stopPath = join(root, "worker.stop");
  let completed = 0;
  try {
    do {
      try { await readFile(stopPath); shouldStop = true; } catch {}
      if (shouldStop) break;

      const records = larkAdapter.recordList();
      await publishStatus({ queue: await queueSnapshot(records), last_heartbeat_at: new Date().toISOString() });
      const recordIds = args.recordIds.length ? args.recordIds : await selectRunnableRecordIds(root, records, args.maxTasks);
      for (const rid of recordIds) {
        if (shouldStop || completed >= args.maxTasks) break;
        try { if (await processTask(rid, args.faultAfterStage)) completed++; }
        catch (e) {
          if (e instanceof PlatformAdapterError && e.code === "rate_limited") {
            console.error(`[${rid.slice(-8)}] 平台限流已达上限，任务延后到下一轮处理`);
            await publishStatus({ current_task: null, last_error: null });
            try { await updateRecord(rid, { "处理状态": "pending", "最近错误": "" }); } catch {}
          } else {
            const message = e instanceof Error ? e.message : String(e); console.error(`[${rid.slice(-8)}] 失败: ${message}`); await publishStatus({ current_task: null, last_error: { message: message.slice(0, 240), time: new Date().toISOString() } }); try { await updateRecord(rid, { "处理状态": "failed", "最近错误": String(e), "处理时间": Date.now() }); } catch {} try { await saveStage(root, rid, "failed"); } catch {}
          }
        }
        try {
          const cleanup = await runPostTaskCleanup(root);
          if (cleanup.freedBytes > 0) console.log(`[cleanup] 任务处理完成，自动清理: ${cleanup.deletedMedia} mp4 / ${cleanup.deletedStage} stage / ${cleanup.deletedTemp} tmp / ${cleanup.deletedDirs} dir, 释放 ${(cleanup.freedBytes / 1024 / 1024).toFixed(1)}MB`);
        } catch (cleanupErr) { console.error(`[cleanup] 自动清理失败: ${cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr)}`); }
      }

      if (args.recordIds.length || !shouldContinuePolling({ runOnce: args.runOnce, stopRequested: shouldStop })) break;
      completed = 0;
      await new Promise(resolveDelay => setTimeout(resolveDelay, args.pollIntervalMs));
    } while (true);
  } finally {
    clearInterval(heartbeat);
    await publishStatus({ worker_state: "stopped", current_task: null, last_heartbeat_at: new Date().toISOString() }).catch(() => undefined);
    await releaseLock(root, lockToken);
    try { await unlink(stopPath); } catch {}
  }
  console.log(`Worker完成: ${completed}`);
}

main().catch(e => { console.error(e); process.exit(1); });
