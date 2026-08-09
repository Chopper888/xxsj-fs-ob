
/*
 * ====== Cache Lifecycle Rules ======
 *
 * LONG-TERM TEXT ARCHIVE (keep permanently):
 *   1. asr-raw.json         — Qwen/Large-v3 raw transcript
 *   2. Obsidian Markdown    — Final note in vault
 *
 * RUNTIME CACHE (keep until done or failed recovery window):
 *   - source.mp4            — Delete: 7 days after done, keep for failed tasks
 *   - stage.json            — Keep: until done, archive on done, delete after 30 days
 *   - DeepSeek raw cache    — Delete: immediately after done
 *   - Temp Markdown (.tmp.*) — Delete: immediately after atomic rename
 *   - Atomic temp files     — Delete: immediately after rename or on failure
 *   - worker.lock           — Delete: on graceful shutdown or stale cleanup
 *
 * CLEANUP RULES:
 *   1. After done: delete DeepSeek cache, temp files immediately
 *   2. After done: keep source.mp4 for 7 days (re-analysis window)
 *   3. stage.json: archive on done, batch-delete after 30 days
 *   4. Failed tasks: keep ALL cache for 14 days (debug window)
 *   5. obsidian_written_base_update_failed: keep stage.json until manually resolved
 *   6. Cleanup MUST check Base status and stage before deleting
 *   7. Future cleanup task: dry-run mode required
 *   8. Never delete: incomplete tasks, recoverable tasks, obsidian_written_base_update_failed tasks
 */
﻿import { createHash, randomUUID } from "node:crypto";
import { readFile, writeFile, mkdir, access, rename, unlink } from "node:fs/promises";
import { join } from "node:path";

// --- Types ---
export type ProcessStage =
  | "pending" | "claimed" | "metadata_resolved" | "media_downloaded" | "asr_completed"
  | "analysis_completed" | "markdown_ready" | "obsidian_written" | "done" | "failed";

export interface TaskClaim {
  recordId: string;
  workId: string;
  workerId: string;
  leaseToken: string;
  claimedAt: string;
  stage: ProcessStage;
  sourceUrl: string;
  title: string;
  platform: string;
}

// === Base field whitelist (from actual Feishu Base schema) ===
export const BASE_FIELD_NAMES = [
  "标题", "原文链接", "来源平台", "作者", "日期", "一级标签", "概述",
  "二级标签", "去重ID", "处理状态", "备注", "重试次数", "最近错误",
  "处理时间", "知识库路径", "收藏时间",
] as const;

export function validateBaseFields(fields: Record<string, unknown>): void {
  for (const key of Object.keys(fields)) {
    if (!(BASE_FIELD_NAMES as readonly string[]).includes(key)) {
      throw new Error("base_field_not_found:" + key);
    }
  }
}

// === Media URL resolution contract ===
// sourceUrl: Douyin page URL (permanent source only)
// resolvedUrl: CDN direct link (preferred for Qwen)
// mediaPath: local file (for Large-v3 fallback)

export function validateRecordId(recordId: string): string {
  if (!recordId || recordId.length < 10) throw new Error("record_id_too_short");
  if (/[^a-zA-Z0-9]/.test(recordId)) throw new Error("record_id_invalid_chars");
  return recordId;
}

export function resolveMediaUrlForAsr(params: {
  resolvedUrl?: string | null;
  sourceUrl: string;
  mediaPath: string;
}): { url: string; source: "resolved" | "source" | "local"; logSafeUrl: string } {
  // Rule 1: resolvedUrl exists -> use it for Qwen (CDN direct link)
  if (params.resolvedUrl?.trim()) {
    const url = params.resolvedUrl.trim();
    const logSafe = url.replace(/[?&].*$/, "?...[redacted]");
    return { url, source: "resolved", logSafeUrl: logSafe };
  }
  // Rule 2: sourceUrl must NEVER go to Qwen as media URL
  // Only use mediaPath fallback
  return { url: params.mediaPath, source: "local", logSafeUrl: params.mediaPath };
}

// === Stage file management ===
export function resolveStagePath(dataRoot: string, recordId: string): string {
  return join(dataRoot, "data", "tasks", recordId, "stage.json");
}

const LEGACY_STAGE_DIR = "tasks"; // old: <dataRoot>/tasks/<recordId>/stage.json

export function resolveLegacyStagePath(dataRoot: string, recordId: string): string {
  return join(dataRoot, LEGACY_STAGE_DIR, recordId, "stage.json");
}

export async function migrateLegacyStage(dataRoot: string, recordId: string): Promise<boolean> {
  const legacyPath = resolveLegacyStagePath(dataRoot, recordId);
  const newPath = resolveStagePath(dataRoot, recordId);
  try {
    const content = await readFile(legacyPath, "utf8");
    const parsed = JSON.parse(content);
    if (!parsed?.stage) throw new Error("legacy_stage_invalid");
    // Check if new path already exists
    try {
      const existing = JSON.parse(await readFile(newPath, "utf8"));
      if (existing?.stage && existing.stage !== parsed.stage) {
        throw new Error("stage_conflict:legacy=" + parsed.stage + " current=" + existing.stage);
      }
      // Same stage, just clean legacy
      await unlink(legacyPath);
      return true;
    } catch (e: any) {
      if (e.message?.includes("stage_conflict")) throw e;
      // New path doesn't exist, migrate
    }
    // Atomic migration
    const tmpPath = newPath + ".migrate." + Date.now();
    await mkdir(join(dataRoot, "data", "tasks", recordId), { recursive: true });
    await writeFile(tmpPath, content, "utf8");
    await rename(tmpPath, newPath);
    await unlink(legacyPath);
    return true;
  } catch (e: any) {
    if (e.message?.includes("stage_conflict")) return false;
    return false; // no legacy file or migration failed
  }
}

export async function saveStage(dataRoot: string, recordId: string, stage: ProcessStage, detail?: string): Promise<void> {
  const dir = join(dataRoot, "data", "tasks", recordId);
  await mkdir(dir, { recursive: true });
  await writeFile(resolveStagePath(dataRoot, recordId), JSON.stringify({ stage, detail, updatedAt: new Date().toISOString() }, null, 2), "utf8");
}

export async function readStage(dataRoot: string, recordId: string): Promise<{ stage: ProcessStage; detail?: string } | null> {
  try {
    // Check legacy first, migrate if found
    await migrateLegacyStage(dataRoot, recordId);
    return JSON.parse(await readFile(resolveStagePath(dataRoot, recordId), "utf8"));
  } catch { return null; }
}

// --- Product existence checks ---
export async function mediaExists(dataRoot: string, recordId: string): Promise<boolean> {
  try { await access(join(dataRoot, "data", "tasks", recordId, "media", "source.mp4")); return true; } catch { return false; }
}

export async function asrRawExists(dataRoot: string, recordId: string): Promise<boolean> {
  try { await access(join(dataRoot, "data", "tasks", recordId, "transcript", "whisper.json")); return true; } catch { return false; }
}

export async function analysisCacheExists(dataRoot: string, recordId: string): Promise<boolean> {
  try { await access(join(dataRoot, "data", "tasks", recordId, "analysis", "result.json")); return true; } catch { return false; }
}

// --- Single-instance lock ---
const LOCK_FILE = "worker.lock";

export async function tryAcquireLock(dataRoot: string, workerId: string): Promise<boolean> {
  const lockPath = join(dataRoot, LOCK_FILE);
  try {
    const content = JSON.stringify({ pid: process.pid, workerId, startedAt: new Date().toISOString(), token: randomUUID() });
    await writeFile(lockPath, content, { flag: "wx" }); // exclusive create
    return true;
  } catch { return false; }
}

export async function releaseLock(dataRoot: string, token: string): Promise<void> {
  try {
    const lock = await readLock(dataRoot);
    if (lock && lock.token === token) {
      await unlink(join(dataRoot, LOCK_FILE));
    }
  } catch {}
}

export async function readLock(dataRoot: string): Promise<Record<string, unknown> | null> {
  try { return JSON.parse(await readFile(join(dataRoot, LOCK_FILE), "utf8")); } catch { return null; }
}

export async function tryCleanStaleLock(dataRoot: string): Promise<boolean> {
  const lock = await readLock(dataRoot);
  if (!lock) return true; // no lock
  const pid = Number(lock.pid);
  if (!pid) return false;
  try {
    process.kill(pid, 0); // check if process exists
    return false; // process still alive, can't clean
  } catch {
    // Process doesn't exist, clean stale lock
    await unlink(join(dataRoot, LOCK_FILE));
    return true;
  }
}

// --- Resume logic ---
export function determineResumeStage(
  currentStage: ProcessStage,
  products: { media: boolean; asr: boolean; analysis: boolean },
): { startFrom: ProcessStage; skipQwen: boolean; skipDeepSeek: boolean; skipDownload: boolean } {
  if (currentStage === "done") return { startFrom: "done", skipQwen: true, skipDeepSeek: true, skipDownload: true };
  if (products.analysis) return { startFrom: "analysis_completed", skipQwen: true, skipDeepSeek: true, skipDownload: true };
  if (products.asr) return { startFrom: "asr_completed", skipQwen: true, skipDeepSeek: false, skipDownload: true };
  if (products.media) return { startFrom: "media_downloaded", skipQwen: false, skipDeepSeek: false, skipDownload: true };
  return { startFrom: "claimed", skipQwen: false, skipDeepSeek: false, skipDownload: false };
}

// --- Utility ---
export function sha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

export function sanitizeLogUrl(url: string): string {
  return url.replace(/[?&].*$/, "?...[redacted]").replace(/\/\/([^@:]+):[^@]+@/, "//***:***@");
}
