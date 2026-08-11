import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
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
});

describe("Worker polling policy", () => {
  const records = [
    { record_id: "recPending0001", fields: { "处理状态": "pending" } },
    { record_id: "recRetry00002", fields: { "处理状态": "failed", "重试次数": 1 } },
    { record_id: "recDone000003", fields: { "处理状态": "done" } },
    { record_id: "recFailed0004", fields: { "处理状态": "failed", "重试次数": 3 } },
  ];

  it("automatically selects pending and recoverable failed records", () => {
    expect(selectRunnableRecordIds(records, 4)).toEqual(["recPending0001", "recRetry00002"]);
  });

  it("never selects done or exhausted failed records", () => {
    expect(selectRunnableRecordIds(records, 10)).not.toEqual(
      expect.arrayContaining(["recDone000003", "recFailed0004"]),
    );
  });

  it("keeps the default Worker alive but lets run-once exit", () => {
    expect(shouldContinuePolling({ runOnce: false, stopRequested: false })).toBe(true);
    expect(shouldContinuePolling({ runOnce: true, stopRequested: false })).toBe(false);
    expect(shouldContinuePolling({ runOnce: false, stopRequested: true })).toBe(false);
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
