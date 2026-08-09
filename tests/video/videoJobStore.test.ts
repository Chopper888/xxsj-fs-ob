import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { CaptureRecord } from "../../src/domain/types.js";
import { VideoJobStore } from "../../src/video/videoJobStore.js";

function videoRecord(overrides: Partial<CaptureRecord> = {}): CaptureRecord {
  return {
    type: "video",
    title: "视频标题",
    url: "https://www.douyin.com/video/765",
    text: "",
    rawSnapshot: "{}",
    dedupeId: "aweme:765",
    capturedAt: "2026-07-06T10:00:00.000Z",
    status: "pending_deep_processing",
    ...overrides,
  };
}

describe("VideoJobStore", () => {
  it("enqueues video records once", async () => {
    const dir = await mkdtemp(join(tmpdir(), "douyin-video-jobs-"));
    try {
      const store = new VideoJobStore(dir);

      expect(await store.enqueue(videoRecord())).toBe("enqueued");
      expect(await store.enqueue(videoRecord())).toBe("skipped");

      const jobs = await store.readJobs();
      expect(jobs).toHaveLength(1);
      expect(jobs[0]).toMatchObject({
        dedupeId: "aweme:765",
        status: "pending",
        attempts: 0,
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("skips non-video records", async () => {
    const dir = await mkdtemp(join(tmpdir(), "douyin-video-jobs-"));
    try {
      const store = new VideoJobStore(dir);
      expect(await store.enqueue(videoRecord({ type: "text", url: undefined }))).toBe("skipped");
      expect(await store.readJobs()).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("keeps the Feishu record id for later deep-processing updates", async () => {
    const dir = await mkdtemp(join(tmpdir(), "douyin-video-jobs-"));
    try {
      const store = new VideoJobStore(dir);
      expect(await store.enqueue(videoRecord({ feishuRecordId: "rec765" }))).toBe("enqueued");

      const jobs = await store.readJobs();
      expect(jobs[0]?.feishuRecordId).toBe("rec765");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("retries only browser-context transient failures", async () => {
    const dir = await mkdtemp(join(tmpdir(), "douyin-video-jobs-"));
    try {
      const store = new VideoJobStore(dir);
      expect(await store.enqueue(videoRecord({ dedupeId: "aweme:retry" }))).toBe("enqueued");
      expect(await store.enqueue(videoRecord({ dedupeId: "aweme:manual" }))).toBe("enqueued");

      const jobs = await store.readJobs();
      const retryJob = jobs.find((job) => job.dedupeId === "aweme:retry");
      const manualJob = jobs.find((job) => job.dedupeId === "aweme:manual");
      if (!retryJob || !manualJob) throw new Error("missing_test_jobs");

      await store.update({
        ...retryJob,
        status: "failed",
        errorMessage: "browserContext.newPage: Target page, context or browser has been closed",
      });
      await store.update({
        ...manualJob,
        status: "failed",
        errorMessage: "media_audio_stream_missing",
      });

      expect(await store.nextPending()).toMatchObject({ dedupeId: "aweme:retry" });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
