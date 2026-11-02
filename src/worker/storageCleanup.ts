import { readdir, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";

// Retention policy — single source of truth shared by the worker hook,
// the manual audit CLI and all tests. Mirrors the legacy cleanup-dry-run.ps1 rules.
export const RETENTION_DAYS = { doneMedia: 7, doneStage: 30, failedDir: 14 } as const;

// Stages that must never be cleaned (still in flight). Mirrors the PS script list.
export const IN_PROGRESS_STAGES = [
  "pending", "claimed", "metadata_resolved", "media_downloaded",
  "asr_completed", "analysis_completed", "markdown_ready", "obsidian_written",
] as const;

export type CleanupMode = "dry-run" | "execute";
export type CleanupAction = "delete_tmp" | "delete_media" | "delete_stage" | "delete_dir";

export interface CleanupDecision {
  taskId: string;
  stage: string | null;
  action: CleanupAction;
  target: string;
  bytes: number;
}

export interface StorageCleanupOptions {
  dataDir: string;
  mode: CleanupMode;
  now?: Date;
  logger?: (line: string) => void;
}

export interface StorageCleanupResult {
  decisions: CleanupDecision[];
  deletedMedia: number;
  deletedStage: number;
  deletedTemp: number;
  deletedDirs: number;
  freedBytes: number;
}

function ageInDays(fileTime: Date, now: Date): number {
  return (now.getTime() - fileTime.getTime()) / 86_400_000;
}

function mb(bytes: number): string {
  return (bytes / 1024 / 1024).toFixed(2);
}

function days(d: number): string {
  return d.toFixed(1);
}

// PowerShell `-Filter '*.tmp*'` semantics: any leaf name containing ".tmp".
async function collectTmpFiles(dir: string, out: string[]): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) await collectTmpFiles(path, out);
    else if (entry.name.includes(".tmp")) out.push(path);
  }
}

async function folderBytes(path: string): Promise<number> {
  let total = 0;
  const entries = await readdir(path, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const child = join(path, entry.name);
    if (entry.isDirectory()) total += await folderBytes(child);
    else {
      const s = await stat(child).catch(() => null);
      total += s?.size ?? 0;
    }
  }
  return total;
}

export async function runStorageCleanup(options: StorageCleanupOptions): Promise<StorageCleanupResult> {
  const { dataDir, mode } = options;
  const now = options.now ?? new Date();
  const log = options.logger ?? (() => undefined);
  const result: StorageCleanupResult = {
    decisions: [], deletedMedia: 0, deletedStage: 0, deletedTemp: 0, deletedDirs: 0, freedBytes: 0,
  };

  log("=== 任务缓存清理 ===");
  log(mode === "execute" ? "  模式: 真实删除 (execute)" : "  模式: 预演 DRY-RUN（只读，--execute 才删除）");
  log("");

  let taskIds: string[];
  try {
    taskIds = (await readdir(dataDir, { withFileTypes: true }))
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
  } catch {
    log("  无任务缓存目录，无需清理。");
    return result;
  }

  for (const taskId of taskIds) {
    const taskPath = join(dataDir, taskId);
    const stageFile = join(taskPath, "stage.json");
    const mediaFile = join(taskPath, "media", "source.mp4");

    let stage: string | null = null;
    try {
      const parsed = JSON.parse(await readFile(stageFile, "utf8")) as { stage?: unknown };
      stage = typeof parsed.stage === "string" ? parsed.stage : null;
    } catch {
      stage = null;
    }
    const stageLabel = stage ?? "unknown";
    log(`  ${taskId}: stage=${stageLabel}`);

    // Temp files (*.tmp*) — unconditionally deletable, regardless of stage.
    const tmpFiles: string[] = [];
    await collectTmpFiles(taskPath, tmpFiles);
    for (const tmpPath of tmpFiles) {
      const s = await stat(tmpPath).catch(() => null);
      const bytes = s?.size ?? 0;
      log(`    [临时] 删除 ${tmpPath.split(/[\\/]/).pop()} (${mb(bytes)}MB)`);
      if (mode === "execute") await rm(tmpPath, { force: true });
      result.decisions.push({ taskId, stage, action: "delete_tmp", target: tmpPath, bytes });
      result.deletedTemp++;
      result.freedBytes += bytes;
    }

    if (stage === null) {
      log("    [跳过] 无 stage.json（状态未知），不删除");
      continue;
    }
    if ((IN_PROGRESS_STAGES as readonly string[]).includes(stage)) {
      log("    [跳过] 处理中任务，不删除");
      continue;
    }

    if (stage === "done") {
      const mediaStat = await stat(mediaFile).catch(() => null);
      if (mediaStat) {
        const age = ageInDays(mediaStat.mtime, now);
        if (age > RETENTION_DAYS.doneMedia) {
          log(`    [done>7d] 删除 source.mp4 (${mb(mediaStat.size)}MB, ${days(age)} 天前)`);
          if (mode === "execute") await rm(mediaFile, { force: true });
          result.decisions.push({ taskId, stage, action: "delete_media", target: mediaFile, bytes: mediaStat.size });
          result.deletedMedia++;
          result.freedBytes += mediaStat.size;
        } else {
          log(`    [done<=7d] 保留 source.mp4 (${days(age)} 天前)`);
        }
      }
      const stageStat = await stat(stageFile).catch(() => null);
      if (stageStat) {
        const age = ageInDays(stageStat.mtime, now);
        if (age > RETENTION_DAYS.doneStage) {
          log(`    [done>30d] 删除 stage.json (${days(age)} 天前)`);
          if (mode === "execute") await rm(stageFile, { force: true });
          result.decisions.push({ taskId, stage, action: "delete_stage", target: stageFile, bytes: stageStat.size });
          result.deletedStage++;
          result.freedBytes += stageStat.size;
        }
      }
    } else if (stage === "failed") {
      const dirStat = await stat(taskPath).catch(() => null);
      if (dirStat) {
        const age = ageInDays(dirStat.mtime, now);
        if (age > RETENTION_DAYS.failedDir) {
          const bytes = await folderBytes(taskPath);
          log(`    [failed>14d] 删除整个任务目录 (${days(age)} 天前, ${mb(bytes)}MB)`);
          if (mode === "execute") await rm(taskPath, { recursive: true, force: true });
          result.decisions.push({ taskId, stage, action: "delete_dir", target: taskPath, bytes });
          result.deletedDirs++;
          result.freedBytes += bytes;
        } else {
          log(`    [failed<=14d] 保留完整缓存`);
        }
      }
    } else {
      log(`    [跳过] 未知 stage=${stage}`);
    }
  }

  log("");
  log(`=== 汇总: source.mp4=${result.deletedMedia}, stage.json=${result.deletedStage}, 临时文件=${result.deletedTemp}, 目录=${result.deletedDirs}, 释放空间=${(result.freedBytes / 1024 / 1024).toFixed(1)}MB ===`);
  log(mode === "execute" ? "=== 已执行真实删除 ===" : "=== 仅预演，未实际删除（确认无误后加 --execute 执行）===");
  return result;
}

// Worker hook — called after each task completes; always real deletion.
export function taskDataDir(root: string): string {
  return join(root, "data", "tasks");
}

export function runPostTaskCleanup(root: string, now?: Date): Promise<StorageCleanupResult> {
  return runStorageCleanup({ dataDir: taskDataDir(root), mode: "execute", now });
}
