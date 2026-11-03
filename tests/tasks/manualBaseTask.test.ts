import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertTaskEligible,
  baseCellValuesEqual,
  buildDryRunPlan,
  normalizeTaskDedupeId,
  resolveConfiguredWhisperPython,
  resolveWhisperPython,
  writeBaseAttemptSnapshot,
} from "../../src/tasks/manualBaseTask.js";

describe("manual Base task entry", () => {
  it("preserves distinct snapshots for two attempts and their original states", async () => {
    const dir = await mkdtemp(join(tmpdir(), "base-attempt-snapshots-"));
    try {
      const createdAt = new Date("2026-08-02T12:00:00.123Z");
      const first = await writeBaseAttemptSnapshot({
        taskDir: dir, recordId: "rec1", attempt: 1, createdAt,
        fields: { "处理状态": "pending", "重试次数": 0, "最近错误": null, "处理时间": null, "标题": "测试" },
      });
      const second = await writeBaseAttemptSnapshot({
        taskDir: dir, recordId: "rec1", attempt: 2, createdAt,
        fields: { "处理状态": "failed", "重试次数": 1, "最近错误": "download_failed", "处理时间": 123, "标题": "测试" },
      });
      expect(first).not.toBe(second);
      const firstPayload = JSON.parse(await readFile(first, "utf8"));
      const secondPayload = JSON.parse(await readFile(second, "utf8"));
      expect(firstPayload).toMatchObject({ recordId: "rec1", attempt: 1, currentStatus: "pending", retryCount: 0 });
      expect(secondPayload).toMatchObject({ recordId: "rec1", attempt: 2, currentStatus: "failed", retryCount: 1, recentError: "download_failed" });
      expect(firstPayload.fields["标题"]).toBe("测试");
      expect(secondPayload.fields["处理时间"]).toBe(123);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
  it("treats a cleared text cell returned as missing as equal to an empty string", () => {
    expect(baseCellValuesEqual(undefined, "")).toBe(true);
    expect(baseCellValuesEqual(null, "")).toBe(true);
    expect(baseCellValuesEqual("error", "")).toBe(false);
  });
  it("normalizes Douyin work ids without changing the source URL", () => {
    expect(normalizeTaskDedupeId("dy_7666820150208875814", "https://www.douyin.com/video/7666820150208875814"))
      .toBe("douyin:7666820150208875814");
  });

  it("allows pending and explicit failed retries", () => {
    expect(() => assertTaskEligible("pending", { retryFailed: false, force: false })).not.toThrow();
    expect(() => assertTaskEligible("failed", { retryFailed: true, force: false })).not.toThrow();
    expect(() => assertTaskEligible("failed", { retryFailed: false, force: false })).toThrow("failed_requires_retry_failed");
  });

  it("rejects active or completed states unless force is explicit", () => {
    for (const status of ["processing", "draft_ready", "done"]) {
      expect(() => assertTaskEligible(status, { retryFailed: false, force: false })).toThrow(`status_refused:${status}`);
      expect(() => assertTaskEligible(status, { retryFailed: false, force: true })).not.toThrow();
    }
  });

  it("uses the Windows venv interpreter while retaining POSIX support", () => {
    expect(resolveWhisperPython("win32", "fixtures\\project")).toBe("fixtures\\project\\.venv\\Scripts\\python.exe");
    expect(resolveWhisperPython("linux", "/work/fixtures-project")).toBe("/work/fixtures-project/.venv/bin/python");
  });

  it("turns a configured relative Windows interpreter into an absolute path", () => {
    const root = resolve("fixtures", "project");
    expect(resolveConfiguredWhisperPython(".venv/Scripts/python.exe", "win32", root))
      .toBe(root + "\\.venv\\Scripts\\python.exe");
  });

  it("builds a non-mutating one-record dry-run plan", () => {
    const plan = buildDryRunPlan({
      recordId: "rec1",
      sourceUrl: "https://www.douyin.com/video/7666820150208875814",
      status: "pending",
      dedupeId: "dy_7666820150208875814",
      projectRoot: "fixtures\\project",
      pythonPath: "fixtures\\project\\.venv\\Scripts\\python.exe",
    });
    expect(plan).toMatchObject({
      recordId: "rec1",
      parserPath: "detail_api_then_playwright_profile_fallback",
      expectedStateChanges: ["pending", "processing", "draft_ready"],
      normalizedDedupeId: "douyin:7666820150208875814",
    });
    expect(plan.taskDir).toBe("fixtures\\project\\data\\tasks\\rec1");
  });
});
