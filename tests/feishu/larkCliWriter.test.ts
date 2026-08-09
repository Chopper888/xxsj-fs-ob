import { describe, expect, it, vi } from "vitest";
import { LarkCliFeishuWriter } from "../../src/feishu/larkCliWriter.js";

describe("LarkCliFeishuWriter", () => {
  it("writes records through lark-cli record-upsert", async () => {
    const execFile = vi.fn().mockImplementation((_bin, _args, callback) => {
      callback(null, JSON.stringify({ code: 0 }), "");
    }) as unknown as typeof import("node:child_process").execFile;

    const writer = new LarkCliFeishuWriter({
      baseToken: "base_token",
      tableId: "tbl123",
      execFileImpl: execFile,
    });

    await writer.writeFields({ "标题": "测试" });

    expect(execFile).toHaveBeenCalledWith(
      "lark-cli",
      [
        "base",
        "+record-upsert",
        "--as",
        "user",
        "--base-token",
        "base_token",
        "--table-id",
        "tbl123",
        "--json",
        "{\"标题\":\"测试\"}",
      ],
      expect.any(Function),
    );
  });

  it("updates an existing record by dedupe id", async () => {
    const execFile = vi.fn().mockImplementation((_bin, args, callback) => {
      if (args.includes("+record-search")) {
        callback(null, JSON.stringify({ data: { data: [["aweme:1"]], fields: ["去重 ID"], record_id_list: ["rec123"] } }), "");
        return;
      }
      callback(null, JSON.stringify({ code: 0 }), "");
    }) as unknown as typeof import("node:child_process").execFile;

    const writer = new LarkCliFeishuWriter({
      baseToken: "base_token",
      tableId: "tbl123",
      execFileImpl: execFile,
    });

    await writer.writeFields({ "标题": "测试", "去重 ID": "aweme:1" });

    expect(execFile).toHaveBeenNthCalledWith(
      1,
      "lark-cli",
      expect.arrayContaining([
        "+record-search",
        "--keyword",
        "aweme:1",
        "--search-field",
        "去重 ID",
        "--field-id",
        "去重 ID",
      ]),
      expect.any(Function),
    );
    expect(execFile).toHaveBeenNthCalledWith(
      2,
      "lark-cli",
      expect.arrayContaining(["+record-upsert", "--record-id", "rec123"]),
      expect.any(Function),
    );
  });

  it("writes only configured fields when a dedupe id already exists", async () => {
    const execFile = vi.fn().mockImplementation((_bin, args, callback) => {
      if (args.includes("+record-search")) {
        callback(null, JSON.stringify({ data: { data: [["aweme:1"]], fields: ["去重 ID"], record_id_list: ["rec123"] } }), "");
        return;
      }
      callback(null, JSON.stringify({ code: 0 }), "");
    }) as unknown as typeof import("node:child_process").execFile;

    const writer = new LarkCliFeishuWriter({
      baseToken: "base_token",
      tableId: "tbl123",
      execFileImpl: execFile,
    });

    await expect(
      writer.writeFields(
        { "标题": "不要覆盖", "处理状态": "pending_deep_processing", "去重 ID": "aweme:1" },
        { updateFieldsIfExisting: { "处理状态": "ignored" } },
      ),
    ).resolves.toEqual({ recordId: "rec123", matchedExisting: true });

    expect(execFile).toHaveBeenNthCalledWith(
      2,
      "lark-cli",
      expect.arrayContaining(["+record-upsert", "--record-id", "rec123", "--json", "{\"处理状态\":\"ignored\"}"]),
      expect.any(Function),
    );
  });

  it("returns the written record id from record-upsert output", async () => {
    const execFile = vi.fn().mockImplementation((_bin, args, callback) => {
      if (args.includes("+record-list")) {
        callback(null, JSON.stringify({ data: { items: [] } }), "");
        return;
      }
      callback(null, JSON.stringify({ data: { record: { record_id: "rec_created" } } }), "");
    }) as unknown as typeof import("node:child_process").execFile;

    const writer = new LarkCliFeishuWriter({
      baseToken: "base_token",
      tableId: "tbl123",
      execFileImpl: execFile,
    });

    await expect(writer.writeFields({ "标题": "测试", "去重 ID": "aweme:1" })).resolves.toEqual({
      recordId: "rec_created",
    });
  });

  it("accepts record id returned as id in record-upsert output", async () => {
    const execFile = vi.fn().mockImplementation((_bin, args, callback) => {
      if (args.includes("+record-list")) {
        callback(null, JSON.stringify({ data: { items: [] } }), "");
        return;
      }
      callback(null, JSON.stringify({ data: { record: { id: "rec_created" } } }), "");
    }) as unknown as typeof import("node:child_process").execFile;

    const writer = new LarkCliFeishuWriter({
      baseToken: "base_token",
      tableId: "tbl123",
      execFileImpl: execFile,
    });

    await expect(writer.writeFields({ "标题": "测试", "去重 ID": "aweme:1" })).resolves.toEqual({
      recordId: "rec_created",
    });
  });

  it("updates directly by provided record id without lookup", async () => {
    const execFile = vi.fn().mockImplementation((_bin, _args, callback) => {
      callback(null, JSON.stringify({ code: 0 }), "");
    }) as unknown as typeof import("node:child_process").execFile;

    const writer = new LarkCliFeishuWriter({
      baseToken: "base_token",
      tableId: "tbl123",
      execFileImpl: execFile,
    });

    await writer.writeFields({ "标题": "测试", "去重 ID": "aweme:1" }, { recordId: "rec123" });

    expect(execFile).toHaveBeenCalledTimes(1);
    expect(execFile).toHaveBeenCalledWith(
      "lark-cli",
      expect.arrayContaining(["+record-upsert", "--record-id", "rec123"]),
      expect.any(Function),
    );
  });

  it("creates a record when a provided record id is stale and no dedupe match exists", async () => {
    const execFileMock = vi.fn().mockImplementation((_bin, args, callback) => {
      if (args.includes("+record-get")) {
        callback(
          null,
          JSON.stringify({
            data: {
              fields: ["去重 ID"],
              data: [[]],
              record_id_list: ["rec_stale"],
              record_not_found: ["rec_stale"],
            },
          }),
          "",
        );
        return;
      }
      if (args.includes("+record-search") || args.includes("+record-list")) {
        callback(null, JSON.stringify({ data: { data: [], fields: ["去重 ID"], record_id_list: [], items: [] } }), "");
        return;
      }
      callback(null, JSON.stringify({ data: { record: { record_id: "rec_created" } } }), "");
    });
    const execFile = execFileMock as unknown as typeof import("node:child_process").execFile;

    const writer = new LarkCliFeishuWriter({
      baseToken: "base_token",
      tableId: "tbl123",
      execFileImpl: execFile,
    });

    await expect(
      writer.writeFields({ "标题": "测试", "去重 ID": "aweme:1" }, { recordId: "rec_stale", lookupDedupeId: "aweme:1" }),
    ).resolves.toEqual({ recordId: "rec_created" });

    const upsertArgs = execFileMock.mock.calls.at(-1)?.[1] as string[];
    expect(upsertArgs).toContain("+record-upsert");
    expect(upsertArgs).not.toContain("--record-id");
  });

  it("does not create a record when createIfMissing is false", async () => {
    const execFileMock = vi.fn().mockImplementation((_bin, args, callback) => {
      if (args.includes("+record-list")) {
        callback(null, JSON.stringify({ data: { items: [] } }), "");
        return;
      }
      callback(null, JSON.stringify({ code: 0 }), "");
    });
    const execFile = execFileMock as unknown as typeof import("node:child_process").execFile;

    const writer = new LarkCliFeishuWriter({
      baseToken: "base_token",
      tableId: "tbl123",
      execFileImpl: execFile,
    });

    await expect(writer.writeFields({ "处理状态": "needs_manual_review", "去重 ID": "aweme:1" }, {
      createIfMissing: false,
    })).rejects.toThrow("feishu_record_not_found");

    expect(execFileMock).toHaveBeenCalledTimes(3);
  });

  it("creates a record when dedupe id does not exist", async () => {
    const execFileMock = vi.fn().mockImplementation((_bin, args, callback) => {
      if (args.includes("+record-list")) {
        callback(null, JSON.stringify({ data: { items: [] } }), "");
        return;
      }
      callback(null, JSON.stringify({ data: { record: { record_id: "rec_created" } } }), "");
    });
    const execFile = execFileMock as unknown as typeof import("node:child_process").execFile;

    const writer = new LarkCliFeishuWriter({
      baseToken: "base_token",
      tableId: "tbl123",
      execFileImpl: execFile,
    });

    await writer.writeFields({ "标题": "测试", "去重 ID": "aweme:1" });

    expect(execFile).toHaveBeenCalledTimes(4);
    expect(execFileMock.mock.calls[3]?.[1]).not.toContain("--record-id");
  });

  it("falls back to scanning recent records when filtered lookup misses", async () => {
    const execFileMock = vi.fn().mockImplementation((_bin, args, callback) => {
      if (args.includes("+record-search")) {
        callback(null, JSON.stringify({ data: { data: [], fields: ["去重 ID"], record_id_list: [] } }), "");
        return;
      }
      if (args.includes("+record-list") && args.includes("--filter-json")) {
        callback(null, JSON.stringify({ data: { items: [] } }), "");
        return;
      }
      if (args.includes("+record-list")) {
        callback(
          null,
          JSON.stringify({
            data: {
              items: [
                { record_id: "rec_other", fields: { "去重 ID": "aweme:0" } },
                { record_id: "rec_scanned", fields: { "去重 ID": [{ text: "aweme:1" }] } },
              ],
            },
          }),
          "",
        );
        return;
      }
      callback(null, JSON.stringify({ code: 0 }), "");
    });
    const execFile = execFileMock as unknown as typeof import("node:child_process").execFile;

    const writer = new LarkCliFeishuWriter({
      baseToken: "base_token",
      tableId: "tbl123",
      execFileImpl: execFile,
    });

    await writer.writeFields({ "标题": "测试", "去重 ID": "aweme:1" });

    expect(execFileMock).toHaveBeenNthCalledWith(
      4,
      "lark-cli",
      expect.arrayContaining(["+record-upsert", "--record-id", "rec_scanned"]),
      expect.any(Function),
    );
  });

  it("finds existing records through record-search columnar output", async () => {
    const execFileMock = vi.fn().mockImplementation((_bin, args, callback) => {
      if (args.includes("+record-search")) {
        callback(
          null,
          JSON.stringify({
            data: {
              fields: ["去重 ID"],
              data: [["aweme:1"]],
              record_id_list: ["rec_search"],
            },
          }),
          "",
        );
        return;
      }
      callback(null, JSON.stringify({ code: 0 }), "");
    });
    const execFile = execFileMock as unknown as typeof import("node:child_process").execFile;

    const writer = new LarkCliFeishuWriter({
      baseToken: "base_token",
      tableId: "tbl123",
      execFileImpl: execFile,
    });

    await writer.writeFields({ "标题": "不要覆盖", "去重 ID": "aweme:1" }, { updateFieldsIfExisting: { "处理状态": "ignored" } });

    expect(execFileMock).toHaveBeenNthCalledWith(
      2,
      "lark-cli",
      expect.arrayContaining(["+record-upsert", "--record-id", "rec_search", "--json", "{\"处理状态\":\"ignored\"}"]),
      expect.any(Function),
    );
  });

  it("looks up the created record id when record-upsert output has no id", async () => {
    let didWrite = false;
    const execFileMock = vi.fn().mockImplementation((_bin, args, callback) => {
      if (args.includes("+record-search")) {
        callback(
          null,
          JSON.stringify({
            data: {
              fields: ["去重 ID"],
              data: didWrite ? [["aweme:1"]] : [],
              record_id_list: didWrite ? ["rec_after_create"] : [],
            },
          }),
          "",
        );
        return;
      }
      if (args.includes("+record-list")) {
        callback(
          null,
          JSON.stringify({
            data: {
              items: didWrite ? [{ record_id: "rec_after_create", fields: { "去重 ID": "aweme:1" } }] : [],
            },
          }),
          "",
        );
        return;
      }
      didWrite = true;
      callback(null, JSON.stringify({ code: 0 }), "");
    });
    const execFile = execFileMock as unknown as typeof import("node:child_process").execFile;

    const writer = new LarkCliFeishuWriter({
      baseToken: "base_token",
      tableId: "tbl123",
      execFileImpl: execFile,
    });

    await expect(writer.writeFields({ "标题": "测试", "去重 ID": "aweme:1" })).resolves.toEqual({
      recordId: "rec_after_create",
    });
  });

  it("redacts lark-cli failure details", async () => {
    const execFile = vi.fn().mockImplementation((_bin, _args, callback) => {
      callback(
        new Error('Command failed: lark-cli --base-token base_token --json {"标题":"测试"}'),
        "",
        'failed with base_token and {"标题":"测试"}',
      );
    }) as unknown as typeof import("node:child_process").execFile;

    const writer = new LarkCliFeishuWriter({
      baseToken: "base_token",
      tableId: "tbl123",
      execFileImpl: execFile,
    });

    await expect(writer.writeFields({ "标题": "测试" })).rejects.toThrow("feishu_write_failed");
    await expect(writer.writeFields({ "标题": "测试" })).rejects.not.toThrow("base_token");
    await expect(writer.writeFields({ "标题": "测试" })).rejects.not.toThrow("测试");
  });
});
