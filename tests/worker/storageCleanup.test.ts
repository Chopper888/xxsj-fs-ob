import { access, mkdir, mkdtemp, readdir, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  RETENTION_DAYS, runPostTaskCleanup, runStorageCleanup, taskDataDir,
  type CleanupDecision, type CleanupMode,
} from "../../src/worker/storageCleanup.js";

const DAY = 86_400_000;
const NOW = new Date("2026-08-12T10:00:00Z");

async function touch(path: string, daysAgo: number): Promise<void> {
  const t = new Date(NOW.getTime() - daysAgo * DAY);
  await utimes(path, t, t);
}

interface TaskSpec {
  stage?: string;
  mediaDaysAgo?: number;
  stageDaysAgo?: number;
  dirDaysAgo?: number;
  tmp?: string[];
}

async function makeTask(dataDir: string, id: string, spec: TaskSpec): Promise<void> {
  const dir = join(dataDir, id);
  await mkdir(dir, { recursive: true });
  if (spec.stage !== undefined) {
    const stageFile = join(dir, "stage.json");
    await writeFile(stageFile, JSON.stringify({ stage: spec.stage, updatedAt: NOW.toISOString() }), "utf8");
    if (spec.stageDaysAgo !== undefined) await touch(stageFile, spec.stageDaysAgo);
  }
  if (spec.mediaDaysAgo !== undefined) {
    await mkdir(join(dir, "media"), { recursive: true });
    const mediaFile = join(dir, "media", "source.mp4");
    await writeFile(mediaFile, "x".repeat(1024), "utf8");
    await touch(mediaFile, spec.mediaDaysAgo);
  }
  for (const name of spec.tmp ?? []) {
    const tmpFile = join(dir, name);
    await writeFile(tmpFile, "tmp", "utf8");
    await touch(tmpFile, 1);
  }
  if (spec.dirDaysAgo !== undefined) await touch(dir, spec.dirDaysAgo);
}

async function cleanTemp(dataDir: string): Promise<void> {
  await rm(dataDir, { recursive: true, force: true });
}

async function exists(path: string): Promise<boolean> {
  try { await access(path); return true; } catch { return false; }
}

async function run(dataDir: string, mode: CleanupMode) {
  return runStorageCleanup({ dataDir, mode, now: NOW, logger: () => undefined });
}

function actions(decisions: CleanupDecision[]): string[] {
  return decisions.map((d) => d.action).sort();
}

describe("storage cleanup retention rules (port of cleanup-dry-run.ps1)", () => {
  it("done 任务 source.mp4 超过 7 天删除，stage.json 30 天内保留", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sc-"));
    try {
      await makeTask(dir, "t1", { stage: "done", mediaDaysAgo: 10, stageDaysAgo: 10, dirDaysAgo: 10 });
      const res = await run(dir, "dry-run");
      expect(actions(res.decisions)).toEqual(["delete_media"]);
      expect(await exists(join(dir, "t1", "media", "source.mp4"))).toBe(true);
    } finally { await cleanTemp(dir); }
  });

  it("done 任务 source.mp4 7 天内保留，stage.json 30 天内保留", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sc-"));
    try {
      await makeTask(dir, "t1", { stage: "done", mediaDaysAgo: 2, stageDaysAgo: 2, dirDaysAgo: 2 });
      const res = await run(dir, "dry-run");
      expect(res.decisions).toEqual([]);
    } finally { await cleanTemp(dir); }
  });

  it("done 任务 stage.json 超过 30 天连同过期 source.mp4 一并删除", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sc-"));
    try {
      await makeTask(dir, "t1", { stage: "done", mediaDaysAgo: 35, stageDaysAgo: 35, dirDaysAgo: 35 });
      const res = await run(dir, "dry-run");
      expect(actions(res.decisions)).toEqual(["delete_media", "delete_stage"]);
    } finally { await cleanTemp(dir); }
  });

  it("failed 任务目录超过 14 天整体删除，execute 模式真正删除", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sc-"));
    try {
      await makeTask(dir, "t1", { stage: "failed", mediaDaysAgo: 20, stageDaysAgo: 20, dirDaysAgo: 20 });
      const dry = await run(dir, "dry-run");
      expect(actions(dry.decisions)).toEqual(["delete_dir"]);
      expect(await exists(join(dir, "t1"))).toBe(true);
      const exec = await run(dir, "execute");
      expect(actions(exec.decisions)).toEqual(["delete_dir"]);
      expect(await exists(join(dir, "t1"))).toBe(false);
    } finally { await cleanTemp(dir); }
  });

  it("failed 任务目录内的临时文件仍被清理（删除临时文件会刷新目录 mtime，整体删除判定随后进行）", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sc-"));
    try {
      // 目录 mtime 设为 20 天前；临时文件删除会刷新目录 mtime，因此 execute 后目录保留、
      // 但临时文件确实被删 —— 与 PS 脚本行为一致（先清 tmp 再判 failed）。
      await makeTask(dir, "t1", { stage: "failed", mediaDaysAgo: 20, stageDaysAgo: 20, dirDaysAgo: 20, tmp: ["stray.tmp"] });
      const res = await run(dir, "execute");
      expect(actions(res.decisions)).toEqual(["delete_tmp"]);
      expect(await exists(join(dir, "t1", "stray.tmp"))).toBe(false);
      expect(await exists(join(dir, "t1"))).toBe(true);
    } finally { await cleanTemp(dir); }
  });

  it("failed 任务 14 天内保留", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sc-"));
    try {
      await makeTask(dir, "t1", { stage: "failed", mediaDaysAgo: 5, stageDaysAgo: 5, dirDaysAgo: 5 });
      const res = await run(dir, "dry-run");
      expect(res.decisions).toEqual([]);
    } finally { await cleanTemp(dir); }
  });

  it("处理中任务绝不删除（含过期 source.mp4 也不动）", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sc-"));
    try {
      await makeTask(dir, "t1", { stage: "media_downloaded", mediaDaysAgo: 99, stageDaysAgo: 99, dirDaysAgo: 99 });
      const res = await run(dir, "dry-run");
      expect(res.decisions).toEqual([]);
    } finally { await cleanTemp(dir); }
  });

  it("无 stage.json（状态未知）绝不删除", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sc-"));
    try {
      await makeTask(dir, "t1", { mediaDaysAgo: 99, dirDaysAgo: 99 });
      const res = await run(dir, "dry-run");
      expect(res.decisions).toEqual([]);
    } finally { await cleanTemp(dir); }
  });

  it("未知 stage 值跳过", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sc-"));
    try {
      await makeTask(dir, "t1", { stage: "weird", mediaDaysAgo: 99, stageDaysAgo: 99 });
      const res = await run(dir, "dry-run");
      expect(res.decisions).toEqual([]);
    } finally { await cleanTemp(dir); }
  });

  it("临时文件 (*.tmp*) 无条件清理，与任务状态无关", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sc-"));
    try {
      await makeTask(dir, "done", { stage: "done", mediaDaysAgo: 1, stageDaysAgo: 1, tmp: ["stray.tmp.old", "note.tmp~"] });
      await makeTask(dir, "unknown", { tmp: ["orphan.tmp"] });
      const dry = await run(dir, "dry-run");
      expect(actions(dry.decisions)).toEqual(["delete_tmp", "delete_tmp", "delete_tmp"]);
      expect(await exists(join(dir, "done", "stray.tmp.old"))).toBe(true);
      const exec = await run(dir, "execute");
      expect(actions(exec.decisions)).toEqual(["delete_tmp", "delete_tmp", "delete_tmp"]);
      expect(await exists(join(dir, "done", "stray.tmp.old"))).toBe(false);
      expect(await exists(join(dir, "unknown", "orphan.tmp"))).toBe(false);
    } finally { await cleanTemp(dir); }
  });

  it("dry-run 只读不删，execute 真实删除", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sc-"));
    try {
      await makeTask(dir, "t1", { stage: "done", mediaDaysAgo: 10, stageDaysAgo: 10, dirDaysAgo: 10 });
      await run(dir, "dry-run");
      expect(await exists(join(dir, "t1", "media", "source.mp4"))).toBe(true);
      await run(dir, "execute");
      expect(await exists(join(dir, "t1", "media", "source.mp4"))).toBe(false);
    } finally { await cleanTemp(dir); }
  });

  it("done 任务只删 source.mp4 与 stage.json，不动 transcript/analysis 等其他产物", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sc-"));
    try {
      await makeTask(dir, "t1", { stage: "done", mediaDaysAgo: 10, stageDaysAgo: 10, dirDaysAgo: 10 });
      await mkdir(join(dir, "t1", "transcript"), { recursive: true });
      await writeFile(join(dir, "t1", "transcript", "whisper.json"), "{}", "utf8");
      await run(dir, "execute");
      expect(await exists(join(dir, "t1", "media", "source.mp4"))).toBe(false);
      expect(await exists(join(dir, "t1", "stage.json"))).toBe(true);
      expect(await exists(join(dir, "t1", "transcript", "whisper.json"))).toBe(true);
    } finally { await cleanTemp(dir); }
  });
});

describe("worker integration hook", () => {
  it("runPostTaskCleanup 以 execute 模式清理 data/tasks", async () => {
    const root = await mkdtemp(join(tmpdir(), "sc-root-"));
    try {
      const dataDir = taskDataDir(root);
      expect(dataDir).toBe(join(root, "data", "tasks"));
      await makeTask(dataDir, "t1", { stage: "done", mediaDaysAgo: 10, stageDaysAgo: 10, dirDaysAgo: 10 });
      const res = await runPostTaskCleanup(root, NOW);
      expect(actions(res.decisions)).toEqual(["delete_media"]);
      expect(await exists(join(dataDir, "t1", "media", "source.mp4"))).toBe(false);
    } finally { await cleanTemp(root); }
  });

  it("runPostTaskCleanup 对有效期内的产物不做删除", async () => {
    const root = await mkdtemp(join(tmpdir(), "sc-root-"));
    try {
      await makeTask(taskDataDir(root), "t1", { stage: "done", mediaDaysAgo: 2, stageDaysAgo: 2, dirDaysAgo: 2 });
      const res = await runPostTaskCleanup(root, NOW);
      expect(res.decisions).toEqual([]);
      expect(await exists(join(taskDataDir(root), "t1", "media", "source.mp4"))).toBe(true);
    } finally { await cleanTemp(root); }
  });

  it("保留期常量与 PS 脚本一致：7/30/14", () => {
    expect(RETENTION_DAYS).toEqual({ doneMedia: 7, doneStage: 30, failedDir: 14 });
  });
});
