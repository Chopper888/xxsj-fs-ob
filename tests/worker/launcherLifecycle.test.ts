import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  getRetryBackoffMs,
  isRetryEligible,
  prepareAttemptFields,
  selectRunnableRecordIds,
  shouldContinuePolling,
} from "../../src/worker/workerLifecycle.js";
import { resolveLarkCliBin, resolveLarkIdentity } from "../../src/base/larkCliAdapter.js";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

describe("Windows launcher contract", () => {
  it("keeps the CMD launcher ASCII-only with CRLF line endings", async () => {
    const bytes = await readFile(join(projectRoot, "start-xxsj-fs-ob-worker.cmd"));
    expect([...bytes].every((byte) => byte < 128)).toBe(true);
    const text = bytes.toString("ascii");
    expect(text).toMatch(/\r\n/);
    expect(text.replace(/\r\n/g, "")).not.toContain("\n");
  });

  it("delegates only to the adjacent PowerShell launcher", async () => {
    const text = await readFile(join(projectRoot, "start-xxsj-fs-ob-worker.cmd"), "ascii");
    expect(text).toContain("%~dp0start-xxsj-fs-ob-worker.ps1");
    expect(text).not.toMatch(/[A-Z]:\\/i);
    expect(text).not.toContain("chcp");
    expect(text).not.toContain("scripts\\start-worker.ps1");
  });

  it("accepts the live tsx Worker PID recorded by the lock", async () => {
    const text = await readFile(join(projectRoot, "scripts/start-worker.ps1"), "utf8");
    expect(text).toContain("Get-CimInstance Win32_Process");
    expect(text).toContain("run-auto-worker");
    expect(text).not.toContain("-eq $child.Id");
  });

  it("ships one-shot status and observer-only monitor scripts", async () => {
    const status = await readFile(join(projectRoot, "scripts/status-worker.ps1"), "utf8");
    const monitor = await readFile(join(projectRoot, "scripts/monitor-worker.ps1"), "utf8");
    expect(status).toContain("worker-status.json");
    expect(status).toContain("STATUS UNAVAILABLE");
    expect(monitor).toContain("[switch]$Once");
    expect(monitor).not.toContain("stop-worker.ps1");
    expect(monitor).not.toContain("Stop-Process");
  });

  it("opens the monitor after reusing or starting the Worker", async () => {
    const text = await readFile(join(projectRoot, "start-xxsj-fs-ob-worker.ps1"), "utf8");
    expect(text).toContain("monitor-worker.ps1");
    expect(text).toContain("Start-Process");
  });
});

describe("Worker polling policy", () => {
  const records = [
    { record_id: "recPending0001", fields: { "处理状态": "pending", "来源平台": "抖音" } },
    { record_id: "recRetry00002", fields: { "处理状态": "failed", "来源平台": "抖音", "最近错误": "network_timeout" } },
    { record_id: "recDone000003", fields: { "处理状态": "done", "来源平台": "抖音" } },
    { record_id: "recFailed0004", fields: { "处理状态": "failed", "来源平台": "抖音", "最近错误": "network_timeout" } },
  ];
  // 重试次数改存本地 stage.json，测试里用 Map 注入，避免依赖磁盘文件
  const retryCounts = new Map([["recRetry00002", 1], ["recFailed0004", 3]]);

  it("selects supported WeChat records in the unified queue", async () => {
    const input = [
      { record_id: "recWechat001", fields: { "处理状态": "pending", "来源平台": "公众号" } },
      { record_id: "recWechat002", fields: { "处理状态": "pending", "来源平台": "微信公众号" } },
    ];
    expect(await selectRunnableRecordIds("", input, 4)).toEqual(["recWechat001", "recWechat002"]);
  });

  it("bounds verification retries but permits transient WeChat network retries", () => {
    expect(isRetryEligible({ "处理状态": "failed", "来源平台": "公众号", "最近错误": "verification_required" }, 0)).toBe(false);
    expect(isRetryEligible({ "处理状态": "failed", "来源平台": "公众号", "最近错误": "temporary_network" }, 0)).toBe(true);
    expect(isRetryEligible({ "处理状态": "failed", "来源平台": "微信公众号", "最近错误": "temporary_network" }, 0)).toBe(true);
  });

  it("automatically selects pending and recoverable failed records", async () => {
    expect(await selectRunnableRecordIds("", records, 4, new Date(), retryCounts)).toEqual(["recPending0001", "recRetry00002"]);
  });

  it("never selects done or exhausted failed records", async () => {
    expect(await selectRunnableRecordIds("", records, 10, new Date(), retryCounts)).not.toEqual(
      expect.arrayContaining(["recDone000003", "recFailed0004"]),
    );
  });

  it("keeps the default Worker alive but lets run-once exit", () => {
    expect(shouldContinuePolling({ runOnce: false, stopRequested: false })).toBe(true);
    expect(shouldContinuePolling({ runOnce: true, stopRequested: false })).toBe(false);
    expect(shouldContinuePolling({ runOnce: false, stopRequested: true })).toBe(false);
  });

  it("prevents failed records from starving a later pending record", async () => {
    const input = [1, 2, 3, 4].map((n) => ({
      record_id: `recFailed00${n}`,
      fields: { "处理状态": "failed", "来源平台": "抖音", "最近错误": "network_timeout" },
    }));
    input.push({ record_id: "recPending999", fields: { "处理状态": "pending", "来源平台": "抖音", "最近错误": "" } });
    const counts = new Map(input.filter((r) => r.fields["处理状态"] === "failed").map((r) => [r.record_id, 0]));
    expect(await selectRunnableRecordIds("", input, 4, new Date("2026-08-12T10:30:00Z"), counts)).toContain("recPending999");
  });

  it("fills pending then draft_ready before retryable failed", async () => {
    const input = [
      ...[1, 2].map((n) => ({ record_id: `recPending00${n}`, fields: { "处理状态": "pending", "来源平台": "抖音" } })),
      ...[1, 2].map((n) => ({ record_id: `recDraft000${n}`, fields: { "处理状态": "draft_ready", "来源平台": "抖音" } })),
      ...Array.from({ length: 10 }, (_, n) => ({ record_id: `recFailed${String(n).padStart(3, "0")}`, fields: { "处理状态": "failed", "来源平台": "抖音", "最近错误": "network_timeout" } })),
    ];
    const counts = new Map(input.filter((r) => r.fields["处理状态"] === "failed").map((r) => [r.record_id, 0]));
    expect(await selectRunnableRecordIds("", input, 4, new Date("2026-08-12T10:30:00Z"), counts)).toEqual([
      "recPending001", "recPending002", "recDraft0001", "recDraft0002",
    ]);
  });

  it("retries supported B站/YouTube network failures but never unsupported platforms or permanent errors", () => {
    expect(isRetryEligible({ "处理状态": "failed", "来源平台": "B站", "最近错误": "network_timeout" }, 0)).toBe(true);
    expect(isRetryEligible({ "处理状态": "failed", "来源平台": "YouTube", "最近错误": "network_timeout" }, 0)).toBe(true);
    expect(isRetryEligible({ "处理状态": "failed", "来源平台": "小红书", "最近错误": "network_timeout" }, 0)).toBe(false);
    expect(isRetryEligible({ "处理状态": "failed", "来源平台": "抖音", "最近错误": "media_target_id_missing" }, 0)).toBe(false);
  });

  it("writes only processing/clear/attempt-time fields on claim (retry count stays local)", () => {
    const fields = prepareAttemptFields();
    expect(fields).toMatchObject({ "处理状态": "processing", "最近错误": "" });
    expect(fields).toHaveProperty("处理时间");
    expect(fields).not.toHaveProperty("重试次数");
  });

  it("stops selecting failed records at the retry maximum", () => {
    expect(isRetryEligible({ "处理状态": "failed", "来源平台": "抖音", "最近错误": "network_timeout" }, 3)).toBe(false);
  });

  it("applies retry backoff and selects recoverable failures after it expires", () => {
    expect(getRetryBackoffMs(0)).toBe(60_000);
    expect(getRetryBackoffMs(1)).toBe(300_000);
    expect(getRetryBackoffMs(2)).toBe(900_000);
    const fields = { "处理状态": "failed", "来源平台": "抖音", "最近错误": "download_timeout", "处理时间": "2026-08-12T10:00:00Z" };
    expect(isRetryEligible(fields, 1, new Date("2026-08-12T10:04:59Z"))).toBe(false);
    expect(isRetryEligible(fields, 1, new Date("2026-08-12T10:05:00Z"))).toBe(true);
  });
});

describe("unattended Base identity", () => {
  it("uses bot identity by default", () => {
    expect(resolveLarkIdentity(undefined)).toBe("bot");
    expect(resolveLarkIdentity("user")).toBe("user");
  });

  it("does not hardcode a Windows user path for lark-cli", () => {
    expect(resolveLarkCliBin(undefined)).toBe("lark-cli");
    expect(resolveLarkCliBin("X:/tools/lark-cli.cmd")).toBe("X:/tools/lark-cli.cmd");
  });
});
