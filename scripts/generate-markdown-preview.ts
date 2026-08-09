import "dotenv/config";
import { access, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { resolveDouyinMediaWithBrowser } from "../src/media/douyinMediaCapture.js";
import { renderMarkdownPreview, type DownloadUrlStatus, type TranscriptReviewCandidate } from "../src/preview/markdownPreview.js";

type Fields = Record<string, unknown>;
const root = resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);
const recordId = args[args.indexOf("--record-id") + 1];
if (!recordId || recordId.startsWith("--")) throw new Error("usage: --record-id <id>");
if (recordId !== "recvr510Ek3WgD") throw new Error("preview_scope_refused:single_approved_record_only");
const taskDir = join(root, "data", "tasks", recordId);
const previewDir = join(taskDir, "preview");

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`missing_env:${name}`);
  return value;
}

async function baseApi(path: string): Promise<any> {
  const token = (await readFile(process.env.FEISHU_TOKEN_FILE ?? process.env.FEISHU_TOKEN_FILE ?? path.join(process.env.XXSJ_FS_OB_PROJECT_ROOT ?? ".", "feishu_token.txt"), "utf8")).trim();
  const url = `https://open.feishu.cn/open-apis/bitable/v1/apps/${required("FEISHU_BASE_TOKEN")}/tables/${required("FEISHU_TABLE_ID")}${path}`;
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const payload = await response.json() as any;
  if (!response.ok || payload.code !== 0) throw new Error(`base_read_failed:${payload.code ?? response.status}`);
  return payload.data;
}

async function atomicWrite(path: string, content: string): Promise<void> {
  const temporary = `${path}.tmp`;
  await writeFile(temporary, content, "utf8");
  await rename(temporary, path);
}

async function preserveOriginalTranscript(path: string, transcript: string): Promise<void> {
  try {
    await access(path);
    if ((await readFile(path, "utf8")) !== transcript) throw new Error("transcript_original_conflict");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    await writeFile(path, transcript, { encoding: "utf8", flag: "wx" });
  }
}

function taipeiIso(value: unknown): string {
  const milliseconds = Number(value);
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) return "";
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).format(new Date(milliseconds));
  return `${parts.replace(" ", "T")}+08:00`;
}

async function checkDirectUrl(url: string): Promise<DownloadUrlStatus> {
  try {
    const response = await fetch(url, { method: "HEAD", redirect: "follow" });
    if (response.ok) return "available";
    if ([401, 403, 404, 410].includes(response.status)) return "expired";
    return "unknown";
  } catch {
    return "unknown";
  }
}

function forbiddenArtifactText(content: string): string | undefined {
  return content.match(/authorization\s*:|bearer\s+|api[_ -]?key|cookie\s*:|client_secret|app_secret/i)?.[0];
}

async function main() {
  const beforeFields = ((await baseApi(`/records/${recordId}`)).record.fields ?? {}) as Fields;
  if (beforeFields["处理状态"] !== "draft_ready") throw new Error(`preview_status_refused:${String(beforeFields["处理状态"] ?? "missing")}`);
  const originalUrl = String(beforeFields["原文链接"] ?? "");
  const workId = originalUrl.match(/(?:\/video\/|[?&]modal_id=)(\d+)/)?.[1] ?? "";
  if (!workId) throw new Error("douyin_work_id_missing");

  const mediaPath = join(taskDir, "media", "source.mp4");
  await access(mediaPath);
  const whisper = JSON.parse(await readFile(join(taskDir, "transcript", "whisper.json"), "utf8")) as { text?: string; model?: string };
  const transcript = String(whisper.text ?? "").trim();
  if (!transcript) throw new Error("transcript_empty");
  const analysis = JSON.parse(await readFile(join(taskDir, "analysis", "result.json"), "utf8")) as any;
  if (analysis.source_record_id !== recordId) throw new Error("analysis_record_mismatch");

  const resolved = await resolveDouyinMediaWithBrowser({
    inputUrl: originalUrl,
    userDataDir: join(root, ".browser", "douyin"),
    headless: false,
    timeoutMs: 30_000,
  });
  const downloadUrlStatus = await checkDirectUrl(resolved.directUrl);
  const corrections: TranscriptReviewCandidate[] = (analysis.transcript_corrections ?? []).map((item: any) => {
    const isNamedTerm = String(item.original).toLowerCase().includes("skyo");
    return {
      original: String(item.original ?? ""), suggestion: String(item.suggested ?? ""), reason: String(item.reason ?? ""),
      confidence: isNamedTerm ? "medium" : "low",
      evidence: isNamedTerm ? ["title", "context"] : ["context"], approved: false, review_note: "",
    };
  });
  const shortTitle = String(beforeFields["标题"] ?? "").split(/[\s。]/)[0] || "抖音视频";
  const normalizedDedupeId = `douyin:${workId}`;
  const videoSummary = {
    video_summary: String(analysis.summary ?? ""),
    summary_sources: ["transcript", "title"],
    summary_confidence: "medium",
  };
  const mediaLinks = {
    original_url: originalUrl,
    resolved_download_url: resolved.directUrl,
    resolved_at: resolved.resolvedAt,
    download_url_status: downloadUrlStatus,
    local_media_path: mediaPath,
  };
  const processedAt = new Date().toISOString();
  const markdown = renderMarkdownPreview({
    title: shortTitle,
    author: String(beforeFields["作者"] ?? ""),
    platform: String(beforeFields["来源平台"] ?? ""),
    originalUrl,
    resolvedDownloadUrl: resolved.directUrl,
    resolvedAt: resolved.resolvedAt,
    downloadUrlStatus,
    localMediaPath: mediaPath,
    workId,
    publishedAt: taipeiIso(beforeFields["日期"]),
    collectedAt: taipeiIso(beforeFields["收藏时间"]),
    primaryCategory: String(analysis.primary_category ?? beforeFields["一级标签"] ?? ""),
    secondaryCategory: String(analysis.secondary_category ?? beforeFields["二级标签"] ?? ""),
    baseRecordId: recordId,
    dedupeId: normalizedDedupeId,
    transcriber: `whisper-${String(whisper.model ?? "base")}`,
    analyzer: String(analysis.model ?? "deepseek-chat"),
    reviewStatus: "needs_review",
    videoSummary: videoSummary.video_summary,
    transcript,
    corrections,
    processedAt,
  });
  const reviewReport = {
    record_id: recordId,
    review_status: "needs_review",
    checks: {
      summary_requires_confirmation: true,
      transcript_complete_in_markdown: markdown.includes(transcript),
      transcript_characters: transcript.length,
      transcript_paragraphs: transcript.split(/\n\s*\n/).filter(Boolean).length,
      original_url_matches_base: mediaLinks.original_url === originalUrl,
      direct_url_status: downloadUrlStatus,
      published_and_collected_separate: beforeFields["日期"] !== beforeFields["收藏时间"],
      corrections_applied: false,
      base_status_before: beforeFields["处理状态"],
      obsidian_written: false,
    },
    questions: [
      "视频提要是否准确、简洁且没有超出标题与逐字稿？",
      "完整逐字稿是否从头到尾无截断或漏段？",
      "直接下载链接当前是否能在你的环境打开或下载？",
      "是否确认 Skyo 应修正为 Skill？",
      "是否批准其他低置信度纠错候选？",
      "是否批准生成 transcript-approved.md？",
      "该Markdown格式是否可作为后续正式Obsidian模板？",
    ],
  };

  await mkdir(previewDir, { recursive: true });
  const artifacts: Record<string, string> = {
    "note-preview.md": markdown,
    "video-summary.json": `${JSON.stringify(videoSummary, null, 2)}\n`,
    "media-links.json": `${JSON.stringify(mediaLinks, null, 2)}\n`,
    "transcript-review.json": `${JSON.stringify(corrections, null, 2)}\n`,
    "review-report.json": `${JSON.stringify(reviewReport, null, 2)}\n`,
  };
  for (const [name, content] of Object.entries(artifacts)) {
    const forbidden = forbiddenArtifactText(content);
    if (forbidden) throw new Error(`preview_secret_scan_failed:${name}`);
    await atomicWrite(join(previewDir, name), content);
  }
  await preserveOriginalTranscript(join(previewDir, "transcript-original.txt"), transcript);

  const afterFields = ((await baseApi(`/records/${recordId}`)).record.fields ?? {}) as Fields;
  if (JSON.stringify(afterFields) !== JSON.stringify(beforeFields)) throw new Error("base_changed_during_preview");
  console.log(JSON.stringify({ previewDir, notePreview: join(previewDir, "note-preview.md"), transcriptCharacters: transcript.length, transcriptParagraphs: reviewReport.checks.transcript_paragraphs, correctionCount: corrections.length, downloadUrlStatus, baseStatus: afterFields["处理状态"], obsidianWritten: false }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
