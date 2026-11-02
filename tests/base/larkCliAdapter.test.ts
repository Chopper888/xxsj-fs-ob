import { describe, expect, it, vi, beforeEach } from "vitest";
import { execSync } from "node:child_process";
import { LarkCliAdapter } from "../../src/base/larkCliAdapter.js";

vi.mock("node:child_process", () => ({
  execSync: vi.fn(),
}));

const execSyncMock = vi.mocked(execSync);

function compactPage(offset: number, rows: number, total: number): string {
  const fields = ["标题", "处理状态"];
  const data: unknown[][] = [];
  const recordIds: string[] = [];
  for (let i = 0; i < rows; i++) {
    const idx = offset + i;
    data.push([`标题${idx}`, ["pending"]]);
    recordIds.push(`rec${String(idx).padStart(3, "0")}`);
  }
  return JSON.stringify({
    ok: true,
    data: { data, fields, record_id_list: recordIds, has_more: offset + rows < total },
  });
}

function mockPages(total: number): void {
  execSyncMock.mockImplementation((cmd: unknown) => {
    const s = String(cmd);
    const match = s.match(/--offset (\d+)/);
    const offset = match ? Number(match[1]) : 0;
    const rows = Math.min(200, total - offset);
    return compactPage(offset, rows, total);
  });
}

describe("LarkCliAdapter.recordList", () => {
  const adapter = new LarkCliAdapter("base", "tbl", "data");

  beforeEach(() => {
    execSyncMock.mockReset();
  });

  it("翻页读取全部记录，不因超过一页而漏掉后续记录", () => {
    const total = 250; // 200 + 50，需要翻页
    mockPages(total);

    const records = adapter.recordList();

    expect(records).toHaveLength(total);
    expect(records[0].record_id).toBe("rec000");
    expect(records[0].fields["处理状态"]).toEqual(["pending"]);
    expect(records[total - 1].record_id).toBe("rec249");
    expect(execSyncMock).toHaveBeenCalledTimes(2);
  });

  it("不足一页时只调用一次且返回全部", () => {
    mockPages(30);

    const records = adapter.recordList();

    expect(records).toHaveLength(30);
    expect(execSyncMock).toHaveBeenCalledTimes(1);
  });

  it("空表返回空数组且不抛错", () => {
    execSyncMock.mockReturnValue(JSON.stringify({
      ok: true,
      data: { data: [], fields: ["标题", "处理状态"], record_id_list: [], has_more: false },
    }));

    expect(adapter.recordList()).toEqual([]);
    expect(execSyncMock).toHaveBeenCalledTimes(1);
  });
});
