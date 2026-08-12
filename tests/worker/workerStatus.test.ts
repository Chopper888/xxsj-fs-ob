import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { access, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import {
  classifyWorkerState,
  createInitialWorkerStatus,
  maskRecordId,
  readWorkerStatus,
  updateWorkerStatus,
  writeWorkerStatus,
} from "../../src/worker/workerStatus.js";

let root: string;
beforeEach(async () => {
  root = join(tmpdir(), `xxsj-status-${randomUUID()}`);
  await mkdir(root, { recursive: true });
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

describe("worker status state", () => {
  it("writes complete UTF-8 JSON atomically without temp residue", async () => {
    const status = createInitialWorkerStatus(123, 10, new Date("2026-08-12T10:00:00Z"));
    status.current_task = { record_id_masked: "rec...测试", platform: "抖音", title: "中文标题", status: "processing", stage: "asr", stage_index: 4, stage_total: 8, started_at: status.started_at };
    await writeWorkerStatus(root, status);
    expect((await readWorkerStatus(root))?.current_task?.title).toBe("中文标题");
    expect((await readdir(join(root, "data", "runtime"))).filter((name) => name.includes(".tmp"))).toEqual([]);
  });

  it("updates heartbeat and merges stage changes", async () => {
    await writeWorkerStatus(root, createInitialWorkerStatus(123, 10, new Date("2026-08-12T10:00:00Z")));
    await updateWorkerStatus(root, { last_heartbeat_at: "2026-08-12T10:00:05.000Z", current_task: { record_id_masked: "rec...0001", platform: "抖音", title: "t", status: "processing", stage: "download", stage_index: 3, stage_total: 8, started_at: "2026-08-12T10:00:00.000Z" } });
    const status = await readWorkerStatus(root);
    expect(status?.last_heartbeat_at).toBe("2026-08-12T10:00:05.000Z");
    expect(status?.current_task?.stage_index).toBe(3);
  });

  it("clears current task and keeps last completion", async () => {
    await writeWorkerStatus(root, createInitialWorkerStatus(123, 10));
    await updateWorkerStatus(root, { current_task: null, last_completed: { title: "完成", finished_at: "2026-08-12T10:05:00.000Z", result: "done" } });
    const status = await readWorkerStatus(root);
    expect(status?.current_task).toBeNull();
    expect(status?.last_completed?.result).toBe("done");
  });

  it("returns null for corrupted status JSON", async () => {
    const dir = join(root, "data", "runtime");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "worker-status.json"), "{partial", "utf8");
    expect(await readWorkerStatus(root)).toBeNull();
  });

  it("classifies running, stalled, stopped, and error", () => {
    const status = createInitialWorkerStatus(123, 10, new Date("2026-08-12T10:00:00Z"));
    expect(classifyWorkerState(status, true, new Date("2026-08-12T10:00:20Z"))).toBe("RUNNING");
    expect(classifyWorkerState(status, true, new Date("2026-08-12T10:01:01Z"))).toBe("STALLED");
    expect(classifyWorkerState(status, false, new Date("2026-08-12T10:00:20Z"))).toBe("STOPPED");
    status.worker_state = "error";
    expect(classifyWorkerState(status, true, new Date("2026-08-12T10:00:20Z"))).toBe("ERROR");
  });

  it("masks record IDs", () => {
    expect(maskRecordId("rec1234567890")).toBe("rec...7890");
  });
});
