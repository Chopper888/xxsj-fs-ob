import "dotenv/config";
import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { captureDouyinMediaWithBrowser } from "../src/media/douyinMediaCapture.js";
import { assertTaskEligible, baseCellValuesEqual, buildDryRunPlan, resolveConfiguredWhisperPython, writeBaseAttemptSnapshot } from "../src/tasks/manualBaseTask.js";
import { transcribeWithFallback } from "../src/asr/asrOrchestrator.js";
import { buildOrchestratorConfigFromEnv } from "../src/asr/providers.js";

type Fields = Record<string, unknown>;

const root = resolve(import.meta.dirname, "..");
const tokenFile = process.env.FEISHU_TOKEN_FILE ?? process.env.FEISHU_TOKEN_FILE ?? path.join(process.env.XXSJ_FS_OB_PROJECT_ROOT ?? ".", "feishu_token.txt");
const baseToken = requiredEnv("FEISHU_BASE_TOKEN");
const tableId = requiredEnv("FEISHU_TABLE_ID");
const apiRoot = `https://open.feishu.cn/open-apis/bitable/v1/apps/${baseToken}/tables/${tableId}`;

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`missing_env:${name}`);
  return value;
}

function parseArgs(argv: string[]) {
  const value = (flag: string) => {
    const index = argv.indexOf(flag);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  const recordId = value("--record-id");
  if (!recordId) throw new Error("usage: --record-id <id> [--dry-run] [--retry-failed] [--force]");
  return {
    recordId,
    dryRun: argv.includes("--dry-run"),
    retryFailed: argv.includes("--retry-failed"),
    force: argv.includes("--force"),
  };
}

async function baseApi(path: string, method = "GET", body?: unknown): Promise<any> {
  const token = (await readFile(tokenFile, "utf8")).trim();
  const response = await fetch(`${apiRoot}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json() as any;
  if (!response.ok || payload.code !== 0) throw new Error(`base_api_failed:${payload.code ?? response.status}:${payload.msg ?? "unknown"}`);
  return payload.data;
}

async function getRecord(recordId: string): Promise<Fields> {
  return (await baseApi(`/records/${recordId}`)).record.fields as Fields;
}

async function updateAndConfirm(recordId: string, fields: Fields): Promise<Fields> {
  await baseApi(`/records/${recordId}`, "PUT", { fields });
  const actual = await getRecord(recordId);
  for (const [key, value] of Object.entries(fields)) {
    if (!baseCellValuesEqual(actual[key], value)) {
      throw new Error(`base_readback_mismatch:${key}`);
    }
  }
  return actual;
}

function run(command: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolveRun, reject) => {
    execFile(command, args, { cwd: root, maxBuffer: 20 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        const detail = String(stderr || stdout || error.message).trim().split(/\r?\n/).at(-1);
        reject(new Error(`${command.split(/[\\/]/).at(-1)}_failed:${detail}`));
        return;
      }
      resolveRun({ stdout: String(stdout), stderr: String(stderr) });
    });
  });
}

async function mediaDuration(path: string): Promise<number> {
  const result = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", path]);
  const seconds = Number(result.stdout.trim());
  if (!Number.isFinite(seconds)) throw new Error("media_duration_unavailable");
  return seconds;
}

function structuredError(stage: string, error: unknown): string {
  return JSON.stringify({ stage, code: error instanceof Error ? error.message : String(error), at: new Date().toISOString() });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const beforeAll = (await baseApi("/records?page_size=100")).items as Array<{ record_id: string; fields: Fields }>;
  const selected = beforeAll.find((item) => item.record_id === args.recordId);
  if (!selected) throw new Error("record_not_found");
  const original = selected.fields;
  const sourceUrl = String(original["原文链接"] ?? "");
  const status = String(original["处理状态"] ?? "");
  const dedupeId = String(original["去重ID"] ?? "");
  if (!sourceUrl.match(/douyin\.com\/(?:video\/|.*[?&]modal_id=)/)) throw new Error("not_a_douyin_video_record");
  assertTaskEligible(status, args);

  const pythonPath = resolveConfiguredWhisperPython(process.env.TRANSCRIBE_PYTHON_PATH, process.platform, root);
  const plan = buildDryRunPlan({ recordId: args.recordId, sourceUrl, status, dedupeId, projectRoot: root, pythonPath });
  console.log(JSON.stringify({ mode: args.dryRun ? "dry-run" : "execute", ...plan }, null, 2));
  if (args.dryRun) return;

  const taskDir = plan.taskDir;
  const transcriptDir = join(taskDir, "transcript");
  const transcriptJson = join(transcriptDir, "whisper.json");
  const transcriptTextPath = join(transcriptDir, "transcript.txt");
  const metadataPath = join(taskDir, "metadata.json");
  const logPath = join(taskDir, "processing.log");
  await mkdir(dirname(plan.mediaPath), { recursive: true });
  await mkdir(plan.temporaryDir, { recursive: true });
  await mkdir(transcriptDir, { recursive: true });
  const attempt = Number(original["重试次数"] ?? 0) + 1;
  const snapshotPaths: string[] = [];
  const log: string[] = [];
  const note = (event: string) => { const line = `${new Date().toISOString()} ${event}`; log.push(line); console.log(line); };
  let stage = "claim";
  try {
    const claimCheck = await getRecord(args.recordId);
    if (!args.force && String(claimCheck["处理状态"] ?? "") !== status) throw new Error("claim_precondition_changed");
    snapshotPaths.push(await writeBaseAttemptSnapshot({ taskDir, recordId: args.recordId, attempt, fields: claimCheck }));
    const startedAt = Date.now();
    await updateAndConfirm(args.recordId, { "处理状态": "processing", "最近错误": "", "处理时间": startedAt });
    note("base_status_confirmed:processing");

    stage = "media_download";
    const media = await captureDouyinMediaWithBrowser({
      inputUrl: sourceUrl,
      outputPath: plan.mediaPath,
      userDataDir: join(root, ".browser", "douyin"),
      headless: false,
      timeoutMs: 30_000,
    }, (kind) => note(`media_candidate:${kind}`));
    note(`media_downloaded:bytes=${media.bytes}:candidates=${media.candidateCount}`);
    const durationSeconds = await mediaDuration(plan.mediaPath);

    stage = "whisper";
    const asrConfig = buildOrchestratorConfigFromEnv(process.env);
    const resolvedMediaUrl = media.resolvedUrl || "";
    const asrResult = await transcribeWithFallback(asrConfig, resolvedMediaUrl, plan.mediaPath, transcriptDir);
    const text = asrResult.text.trim();
    if (!text) throw new Error("transcript_empty");
    await writeFile(transcriptJson, JSON.stringify({
      provider: asrResult.provider, model: asrResult.model,
      text, segments: asrResult.segments,
      elapsed_seconds: asrResult.elapsed_seconds, retries: asrResult.retries,
      started_at: asrResult.started_at, completed_at: asrResult.completed_at,
      fallback: asrResult.fallback ?? null,
    }, null, 2) + "\n", "utf8");
    await writeFile(transcriptTextPath, `${text}\n`, "utf8");
    note(`asr_complete:provider=${asrResult.provider}:model=${asrResult.model}:chars=${text.length}:elapsed=${asrResult.elapsed_seconds.toFixed(3)}:retries=${asrResult.retries}:fallback=${!!asrResult.fallback}`);

    stage = "finalize";
    const metadata = {
      recordId: args.recordId, sourceUrl, normalizedDedupeId: plan.normalizedDedupeId,
      parserPath: plan.parserPath, mediaPath: plan.mediaPath, mediaBytes: media.bytes,
      durationSeconds,
      asr: {
        provider: asrResult.provider, model: asrResult.model,
        elapsedSeconds: asrResult.elapsed_seconds, characters: text.length,
        retries: asrResult.retries, fallback: asrResult.fallback ?? null,
      },
      transcriptTextPath, transcriptJson, startedAtMs: startedAt, completedAt: new Date().toISOString(),
    };
    await writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
    const beforeFinalize = await getRecord(args.recordId);
    snapshotPaths.push(await writeBaseAttemptSnapshot({ taskDir, recordId: args.recordId, attempt, fields: beforeFinalize }));
    await updateAndConfirm(args.recordId, { "处理状态": "draft_ready", "最近错误": "" });
    note("base_status_confirmed:draft_ready");
    await writeFile(logPath, `${log.join("\n")}\n`, "utf8");

    const afterAll = (await baseApi("/records?page_size=100")).items as Array<{ record_id: string; fields: Fields }>;
    const beforeOthers = new Map(beforeAll.filter((x) => x.record_id !== args.recordId).map((x) => [x.record_id, JSON.stringify(x.fields)]));
    for (const item of afterAll.filter((x) => x.record_id !== args.recordId)) {
      if (beforeOthers.get(item.record_id) !== JSON.stringify(item.fields)) throw new Error(`unrelated_record_changed:${item.record_id}`);
    }
    console.log(JSON.stringify({ result: "draft_ready", snapshotPaths, mediaPath: plan.mediaPath, transcriptTextPath, transcriptJson, metadataPath, logPath, ...metadata.asr, durationSeconds }, null, 2));
  } catch (error) {
    const current = await getRecord(args.recordId).catch(() => original);
    snapshotPaths.push(await writeBaseAttemptSnapshot({ taskDir, recordId: args.recordId, attempt, fields: current }).catch(() => "snapshot_failed"));
    const retryCount = Number(current["重试次数"] ?? original["重试次数"] ?? 0);
    const summary = structuredError(stage, error);
    await updateAndConfirm(args.recordId, { "处理状态": "failed", "重试次数": retryCount + 1, "最近错误": summary }).catch(() => undefined);
    note(`failed:${summary}`);
    await writeFile(logPath, `${log.join("\n")}\n`, "utf8").catch(() => undefined);
    throw error;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
