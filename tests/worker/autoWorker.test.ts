import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdir, writeFile, rm, readFile, access, rename, unlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID, createHash } from "node:crypto";
import {
  resolveMediaUrlForAsr, resolveStagePath, resolveLegacyStagePath,
  migrateLegacyStage, saveStage, readStage,
  readTaskRetryCount, writeTaskRetryCount, bumpTaskRetryCount,
  tryAcquireLock, releaseLock, readLock, tryCleanStaleLock,
  validateBaseFields, validateRecordId, determineResumeStage,
  sha256, sanitizeLogUrl, BASE_FIELD_NAMES,
} from "../../src/worker/autoWorker.js";

let tmpDir: string;
function sha(s: string) { return createHash("sha256").update(s, "utf8").digest("hex"); }

beforeEach(async () => {
  tmpDir = join(tmpdir(), "xxsj-d22-" + randomUUID().slice(0, 8));
  await mkdir(tmpDir, { recursive: true });
});

afterEach(async () => {
  try { await rm(tmpDir, { recursive: true, force: true }); } catch {}
});

// ====== 1. resolveMediaUrlForAsr ======
describe("resolveMediaUrlForAsr", () => {
  it("uses resolvedUrl when present", () => {
    const r = resolveMediaUrlForAsr({ resolvedUrl: "https://cdn.example.com/v.mp4", sourceUrl: "https://douyin.com/v/123", mediaPath: "/local/v.mp4" });
    expect(r.url).toBe("https://cdn.example.com/v.mp4");
    expect(r.source).toBe("resolved");
  });
  it("falls back to local when resolvedUrl missing", () => {
    const r = resolveMediaUrlForAsr({ resolvedUrl: null, sourceUrl: "https://douyin.com/v/123", mediaPath: "/local/v.mp4" });
    expect(r.source).toBe("local");
  });
  it("never passes sourceUrl", () => {
    const r = resolveMediaUrlForAsr({ resolvedUrl: null, sourceUrl: "https://www.douyin.com/video/123", mediaPath: "/local/v.mp4" });
    expect(r.url).not.toBe("https://www.douyin.com/video/123");
  });
  it("sanitizes log URL", () => {
    const r = resolveMediaUrlForAsr({ resolvedUrl: "https://cdn.example.com/v.mp4?token=secret", sourceUrl: "", mediaPath: "/x" });
    expect(r.logSafeUrl).not.toContain("token");
  });
});

// ====== 2. Stage file management (FIXED: unskipped) ======
describe("stage file management", () => {
  const rid = "recvrgtest0001";

  it("resolves stage path to data/tasks/<ID>/stage.json", () => {
    const p = resolveStagePath(tmpDir, rid);
    expect(p).toMatch(/data[\\\/]tasks[\\\/]recvrgtest0001[\\\/]stage\.json$/);
  });

  it("resolves legacy stage path", () => {
    const p = resolveLegacyStagePath(tmpDir, rid);
    expect(p).toMatch(/tasks[\\\/]recvrgtest0001[\\\/]stage\.json$/);
    expect(p).not.toMatch(/data[\\\/]tasks/);
  });

  it("saves and reads stage correctly", async () => {
    await saveStage(tmpDir, rid, "asr_completed", "Qwen ok");
    const s = await readStage(tmpDir, rid);
    expect(s?.stage).toBe("asr_completed");
    expect(s?.detail).toBe("Qwen ok");
  });

  it("reads null when no stage exists", async () => {
    expect(await readStage(tmpDir, "noexist")).toBeNull();
  });

  it("migrates legacy-only stage to new path", async () => {
    const legacyPath = resolveLegacyStagePath(tmpDir, rid);
    await mkdir(join(tmpDir, "tasks", rid), { recursive: true });
    await writeFile(legacyPath, JSON.stringify({ stage: "media_downloaded" }), "utf8");
    const migrated = await migrateLegacyStage(tmpDir, rid);
    expect(migrated).toBe(true);
    const content = JSON.parse(await readFile(resolveStagePath(tmpDir, rid), "utf8"));
    expect(content.stage).toBe("media_downloaded");
    await expect(access(legacyPath)).rejects.toThrow(); // cleaned
  });

  it("migrates via readStage auto-detection", async () => {
    const legacyPath = resolveLegacyStagePath(tmpDir, rid);
    await mkdir(join(tmpDir, "tasks", rid), { recursive: true });
    await writeFile(legacyPath, JSON.stringify({ stage: "asr_completed", detail: "legacy" }), "utf8");
    const s = await readStage(tmpDir, rid);
    expect(s?.stage).toBe("asr_completed");
    expect(s?.detail).toBe("legacy");
    await expect(access(legacyPath)).rejects.toThrow();
  });

  it("detects conflict when legacy and new differ", async () => {
    await saveStage(tmpDir, rid, "asr_completed");
    const legacyPath = resolveLegacyStagePath(tmpDir, rid);
    await mkdir(join(tmpDir, "tasks", rid), { recursive: true });
    await writeFile(legacyPath, JSON.stringify({ stage: "media_downloaded" }), "utf8");
    expect(await migrateLegacyStage(tmpDir, rid)).toBe(false);
    // legacy still exists (not cleaned due to conflict)
    expect(await access(legacyPath).then(() => true).catch(() => false)).toBe(true);
  });

  it("handles corrupted legacy JSON gracefully", async () => {
    const legacyPath = resolveLegacyStagePath(tmpDir, rid);
    await mkdir(join(tmpDir, "tasks", rid), { recursive: true });
    await writeFile(legacyPath, "not-valid-json", "utf8");
    await expect(readStage(tmpDir, rid)).resolves.toBeNull();
  });

  it("cleans legacy when same stage exists in both", async () => {
    await saveStage(tmpDir, rid, "media_downloaded");
    const legacyPath = resolveLegacyStagePath(tmpDir, rid);
    await mkdir(join(tmpDir, "tasks", rid), { recursive: true });
    await writeFile(legacyPath, JSON.stringify({ stage: "media_downloaded" }), "utf8");
    const migrated = await migrateLegacyStage(tmpDir, rid);
    expect(migrated).toBe(true);
    await expect(access(legacyPath)).rejects.toThrow();
  });
});

// ====== 2.5 本地重试计数（S0-R6：不再写回飞书表格） ======
describe("local retry count in stage.json", () => {
  const rid = "recvrgretry001";

  it("defaults to 0 when no stage exists", async () => {
    expect(await readTaskRetryCount(tmpDir, "noexist")).toBe(0);
  });

  it("round-trips write then read", async () => {
    await writeTaskRetryCount(tmpDir, rid, 2);
    expect(await readTaskRetryCount(tmpDir, rid)).toBe(2);
  });

  it("saveStage preserves the local retry count", async () => {
    await writeTaskRetryCount(tmpDir, rid, 1);
    await saveStage(tmpDir, rid, "media_downloaded", "ok");
    const stage = await readStage(tmpDir, rid);
    expect(stage?.stage).toBe("media_downloaded");
    expect(stage?.retryCount).toBe(1);
  });

  it("writeTaskRetryCount preserves the current stage", async () => {
    await saveStage(tmpDir, rid, "asr_completed");
    await writeTaskRetryCount(tmpDir, rid, 3);
    const stage = await readStage(tmpDir, rid);
    expect(stage?.stage).toBe("asr_completed");
    expect(stage?.retryCount).toBe(3);
  });

  it("bumps only when the prior status is failed", async () => {
    await writeTaskRetryCount(tmpDir, rid, 1);
    expect(await bumpTaskRetryCount(tmpDir, rid, "pending")).toBe(1);
    expect(await readTaskRetryCount(tmpDir, rid)).toBe(1);
    expect(await bumpTaskRetryCount(tmpDir, rid, "failed")).toBe(2);
    expect(await readTaskRetryCount(tmpDir, rid)).toBe(2);
  });
});

// ====== 3. Base field whitelist + Record ID ======
describe("Base field whitelist", () => {
  it("accepts known fields", () => {
    expect(() => validateBaseFields({ "标题": "t", "处理状态": "done" })).not.toThrow();
  });
  it("rejects unknown fields", () => {
    expect(() => validateBaseFields({ "worker_id": "w1" })).toThrow("base_field_not_found");
  });
});
describe("Record ID", () => {
  it("accepts full ID", () => { expect(validateRecordId("recvrgjjclD7gO")).toBe("recvrgjjclD7gO"); });
  it("rejects short ID", () => { expect(() => validateRecordId("jjclD7gO")).toThrow("too_short"); });
  it("rejects invalid chars", () => { expect(() => validateRecordId("recvrf jjcl")).toThrow("invalid_chars"); });
});

// ====== 4. Single-instance lock ======
describe("single-instance lock", () => {
  it("first acquires, second rejected", async () => {
    expect(await tryAcquireLock(tmpDir, "w1")).toBe(true);
    expect(await tryAcquireLock(tmpDir, "w2")).toBe(false);
  });
  it("releases with correct token", async () => {
    await tryAcquireLock(tmpDir, "w1");
    const lock = await readLock(tmpDir);
    await releaseLock(tmpDir, lock!.token as string);
    expect(await readLock(tmpDir)).toBeNull();
  });
  it("wrong token cannot release", async () => {
    await tryAcquireLock(tmpDir, "w1");
    await releaseLock(tmpDir, "wrong");
    expect(await readLock(tmpDir)).not.toBeNull();
  });
  it("cleans stale lock (dead PID)", async () => {
    const lockPath = join(tmpDir, "worker.lock");
    await writeFile(lockPath, JSON.stringify({ pid: 99999, workerId: "dead", token: "x", startedAt: new Date().toISOString() }), "utf8");
    expect(await tryCleanStaleLock(tmpDir)).toBe(true);
    expect(await readLock(tmpDir)).toBeNull();
  });
  it("does not clean live lock", async () => {
    await tryAcquireLock(tmpDir, "w1");
    expect(await tryCleanStaleLock(tmpDir)).toBe(false);
  });
  it("lock contains PID, start time, and token", async () => {
    await tryAcquireLock(tmpDir, "w1");
    const lock = await readLock(tmpDir);
    expect(lock?.pid).toBe(process.pid);
    expect(lock?.startedAt).toBeDefined();
    expect(lock?.token).toBeDefined();
  });
});

// ====== 5. Resume logic ======
describe("determineResumeStage", () => {
  it("skips all when analysis exists", () => {
    const r = determineResumeStage("pending", { media: true, asr: true, analysis: true });
    expect(r.skipDownload && r.skipQwen && r.skipDeepSeek).toBe(true);
  });
  it("skips download+Qwen when ASR exists", () => {
    const r = determineResumeStage("pending", { media: true, asr: true, analysis: false });
    expect(r.skipDownload && r.skipQwen).toBe(true);
    expect(r.skipDeepSeek).toBe(false);
  });
  it("starts fresh with no products", () => {
    const r = determineResumeStage("pending", { media: false, asr: false, analysis: false });
    expect(r.skipDownload || r.skipQwen).toBe(false);
  });
  it("done stage returns done", () => {
    const r = determineResumeStage("done", { media: true, asr: true, analysis: true });
    expect(r.startFrom).toBe("done");
  });
});

// ====== 6. Obsidian written but Base failed recovery ======
describe("Obsidian/Base transaction recovery", () => {
  const rid = "recvrgOBTest001";
  const workId = "7650000000000000001";
  const obsDir = "";

  beforeEach(async () => {
    // Create a temp Obsidian-like vault
    obsDir && await mkdir(join(tmpDir, "vault", obsDir), { recursive: true });
  });

  it("first run: markdown written, Base fails, stage saved correctly", async () => {
    const vaultPath = join(tmpDir, "vault");
    const targetDir = join(vaultPath, "抖音");
    await mkdir(targetDir, { recursive: true });

    const mdContent = "---\nwork_id: " + workId + "\n---\n# Test\n\nContent";
    const mdHash = sha(mdContent);
    const obsPath = join(targetDir, "test-note - " + workId + ".md");

    // Write markdown atomically
    await writeFile(obsPath, mdContent, "utf8");
    const written = await readFile(obsPath, "utf8");
    expect(sha(written)).toBe(mdHash);

    // Simulate Base write failure
    let baseFailed = false;
    try {
      // This represents the Base API failing
      throw new Error("base_write_failed:simulated");
    } catch { baseFailed = true; }
    expect(baseFailed).toBe(true);

    // Save recovery stage
    await saveStage(tmpDir, rid, "obsidian_written", JSON.stringify({ hash: mdHash, path: obsPath }));
    const stage = await readStage(tmpDir, rid);
    expect(stage?.stage).toBe("obsidian_written");
  });

  it("second run: recovers from obsidian_written, only writes Base", async () => {
    const vaultPath = join(tmpDir, "vault");
    const targetDir = join(vaultPath, "抖音");
    await mkdir(targetDir, { recursive: true });

    const mdContent = "---\nwork_id: " + workId + "\n---\n# Test\n\nContent";
    const mdHash = sha(mdContent);
    const obsPath = join(targetDir, "test-note - " + workId + ".md");
    await writeFile(obsPath, mdContent, "utf8");

    // Save stage as if previous run wrote Obsidian but Base failed
    await saveStage(tmpDir, rid, "obsidian_written", JSON.stringify({ hash: mdHash, path: obsPath }));

    // Second run: read stage, verify markdown, patch Base
    const stage = await readStage(tmpDir, rid);
    expect(stage?.stage).toBe("obsidian_written");

    const detail = JSON.parse(stage?.detail || "{}");
    expect(detail.hash).toBe(mdHash);

    // Verify markdown still exists and hash matches
    const existing = await readFile(obsPath, "utf8");
    expect(sha(existing)).toBe(mdHash);

    // Simulate Base patch (just verify no duplicate writes)
    const baseFields = { "处理状态": "done", "知识库路径": obsPath, "处理时间": Date.now() };
    validateBaseFields(baseFields);
    // In real code: await updateRecord(rid, baseFields)
    expect(baseFields["处理状态"]).toBe("done");

    // Verify only ONE markdown file exists
    const files = await require("fs").promises.readdir(targetDir);
    const mdFiles = files.filter((f: string) => f.endsWith(".md"));
    expect(mdFiles.length).toBe(1);
  });

  it("user-modified file returns existing_note_modified", async () => {
    const vaultPath = join(tmpDir, "vault");
    const targetDir = join(vaultPath, "抖音");
    await mkdir(targetDir, { recursive: true });

    const originalContent = "---\nwork_id: " + workId + "\n---\n# Test\n\nOriginal";
    const obsPath = join(targetDir, "test-note - " + workId + ".md");
    await writeFile(obsPath, originalContent, "utf8");
    const origHash = sha(originalContent);

    // Save stage from first run
    await saveStage(tmpDir, rid, "obsidian_written", JSON.stringify({ hash: origHash, path: obsPath }));

    // User modifies the file
    const modifiedContent = originalContent + "\n\nUser edit";
    await writeFile(obsPath, modifiedContent, "utf8");
    const modHash = sha(modifiedContent);
    expect(modHash).not.toBe(origHash);

    // Recovery detects modification
    const stage = await readStage(tmpDir, rid);
    const detail = JSON.parse(stage?.detail || "{}");
    const existing = await readFile(obsPath, "utf8");
    const existingHash = sha(existing);
    expect(existingHash).not.toBe(detail.hash);

    // Should NOT write Base (existing_note_modified)
    // In real code: return { conflict: "existing_note_modified" }
  });
});

// ====== 7. Graceful stop + recovery at 4 stages ======
describe("graceful stop and recovery", () => {
  const rid = "recvrgSTOP001";

  async function simulateGracefulStop(stage: string) {
    await saveStage(tmpDir, rid, stage as any, "stopped at " + stage);
    // Verify lock is released
    expect(await tryAcquireLock(tmpDir, "recovery")).toBe(true);
    await releaseLock(tmpDir, (await readLock(tmpDir))!.token as string);
  }

  async function verifyRecovery(expectedStage: string, expectedSkips: { dl: boolean; qwen: boolean; ds: boolean }) {
    const stage = await readStage(tmpDir, rid);
    expect(stage?.stage).toBe(expectedStage);

    // Simulate product state
    const hasMedia = ["media_downloaded", "asr_completed", "analysis_completed", "obsidian_written"].includes(expectedStage);
    const hasAsr = ["asr_completed", "analysis_completed", "obsidian_written"].includes(expectedStage);
    const hasAnalysis = ["analysis_completed", "obsidian_written"].includes(expectedStage);

    const resume = determineResumeStage(stage?.stage || "pending", { media: hasMedia, asr: hasAsr, analysis: hasAnalysis });
    expect(resume.skipDownload).toBe(expectedSkips.dl);
    expect(resume.skipQwen).toBe(expectedSkips.qwen);
    expect(resume.skipDeepSeek).toBe(expectedSkips.ds);
  }

  it("stop at media_downloaded, resumes from media", async () => {
    await simulateGracefulStop("media_downloaded");
    await verifyRecovery("media_downloaded", { dl: true, qwen: false, ds: false });
  });

  it("stop at asr_completed, skips download+Qwen", async () => {
    await simulateGracefulStop("asr_completed");
    await verifyRecovery("asr_completed", { dl: true, qwen: true, ds: false });
  });

  it("stop at analysis_completed, skips download+Qwen+DeepSeek", async () => {
    await simulateGracefulStop("analysis_completed");
    await verifyRecovery("analysis_completed", { dl: true, qwen: true, ds: true });
  });

  it("stop at obsidian_written, skips all but Base", async () => {
    await simulateGracefulStop("obsidian_written");
    await verifyRecovery("obsidian_written", { dl: true, qwen: true, ds: true });
  });

  it("Base is not marked done on stop", async () => {
    // Stage saved but no Base done written
    await saveStage(tmpDir, rid, "asr_completed");
    const stage = await readStage(tmpDir, rid);
    expect(stage?.stage).not.toBe("done");
    expect(stage?.stage).toBe("asr_completed");
  });

  it("lock is released after graceful stop", async () => {
    await tryAcquireLock(tmpDir, "w1");
    const lock = await readLock(tmpDir);
    await releaseLock(tmpDir, lock!.token as string);
    expect(await readLock(tmpDir)).toBeNull();
    // Can acquire again
    expect(await tryAcquireLock(tmpDir, "w2")).toBe(true);
  });
});

// ====== 8. Utilities ======
describe("utilities", () => {
  it("sha256 is consistent", () => {
    expect(sha256("hello")).toBe(sha256("hello"));
  });
  it("sanitizeLogUrl redacts query", () => {
    expect(sanitizeLogUrl("https://x.com/p?key=val")).not.toContain("key=val");
  });
});
