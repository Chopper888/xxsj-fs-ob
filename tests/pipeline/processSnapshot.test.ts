import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { processSnapshot } from "../../src/pipeline/processSnapshot.js";
import { LocalStateStore } from "../../src/state/localState.js";

describe("processSnapshot", () => {
  it("updates only processing status when a processed record appears again", async () => {
    const dir = await mkdtemp(join(tmpdir(), "douyin-pipeline-"));
    try {
      const state = new LocalStateStore(dir);
      const writer = { writeFields: vi.fn().mockResolvedValue({ recordId: "rec_text" }) };
      const summarizer = {
        summarizeText: vi.fn().mockResolvedValue({
          summary: "摘要",
          suggestedCategory: "分类",
        }),
      };

      const snapshot = {
        snapshotId: "m1",
        text: "需要研究 RAG 评估",
        html: "<div>需要研究 RAG 评估</div>",
        links: [],
        images: [],
      };

      const first = await processSnapshot(snapshot, { state, writer, summarizer });
      const second = await processSnapshot(snapshot, { state, writer, summarizer });

      expect(first.status).toBe("written");
      expect(first.record?.feishuRecordId).toBe("rec_text");
      expect(second.status).toBe("duplicate_status_updated");
      expect(writer.writeFields).toHaveBeenCalledTimes(2);
      expect(writer.writeFields).toHaveBeenNthCalledWith(
        2,
        { "处理状态": "ignored" },
        {
          recordId: "rec_text",
          lookupDedupeId: first.dedupeId,
          createIfMissing: false,
        },
      );
      expect(summarizer.summarizeText).toHaveBeenCalledTimes(1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("queues records when Feishu write fails", async () => {
    const dir = await mkdtemp(join(tmpdir(), "douyin-pipeline-"));
    try {
      const state = new LocalStateStore(dir);
      const writer = { writeFields: vi.fn().mockRejectedValue(new Error("no auth")) };
      const summarizer = { summarizeText: vi.fn() };

      const result = await processSnapshot(
        {
          snapshotId: "m2",
          text: "视频教程",
          html: '<a href="https://www.douyin.com/video/7650000000000000000">video</a>',
          links: ["https://www.douyin.com/video/7650000000000000000"],
          images: [],
        },
        { state, writer, summarizer },
      );

      expect(result.status).toBe("queued");
      expect(await state.isProcessed("aweme:7650000000000000000")).toBe(true);
      expect(await state.readPending()).toHaveLength(1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("does not write summaries for video records before deep processing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "douyin-pipeline-"));
    try {
      const state = new LocalStateStore(dir);
      const writer = { writeFields: vi.fn().mockResolvedValue({ recordId: "rec_video" }) };
      const summarizer = {
        summarizeText: vi.fn().mockResolvedValue({
          summary: "总结 MacBook Pro 内存选择建议。",
          suggestedCategory: "数码",
        }),
      };

      const result = await processSnapshot(
        {
          snapshotId: "m3",
          title: "MacBook Pro 统一内存应该怎么选？",
          text: "示例作者",
          html: '<div class="MessageItemShareAwemecontainer"><span class="MessageItemShareAwemeautorName">示例作者</span></div>',
          links: ["https://www.douyin.com/jingxuan?modal_id=7650000000000000000"],
          images: ["cover.jpg"],
        },
        { state, writer, summarizer },
      );

      expect(result.status).toBe("written");
      expect(result.record?.feishuRecordId).toBe("rec_video");
      expect(summarizer.summarizeText).not.toHaveBeenCalled();
      expect(writer.writeFields).toHaveBeenCalledWith(
        expect.objectContaining({
          "内容类型": "video",
          "摘要": "",
          "处理状态": "pending_deep_processing",
          "原始文本": "",
          "作者/来源": "示例作者",
        }),
        { updateFieldsIfExisting: { "处理状态": "ignored" } },
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("does not overwrite existing Feishu fields when dedupe id already exists", async () => {
    const dir = await mkdtemp(join(tmpdir(), "douyin-pipeline-"));
    try {
      const state = new LocalStateStore(dir);
      const writer = {
        writeFields: vi.fn().mockResolvedValue({ recordId: "rec_existing", matchedExisting: true }),
      };
      const summarizer = { summarizeText: vi.fn() };

      const result = await processSnapshot(
        {
          snapshotId: "m4",
          title: "新标题不应该覆盖旧记录",
          text: "作者",
          html: '<div class="MessageItemShareAwemecontainer"></div>',
          links: ["https://www.douyin.com/jingxuan?modal_id=7650000000000000000"],
          images: ["cover.jpg"],
        },
        { state, writer, summarizer },
      );

      expect(result.status).toBe("duplicate_status_updated");
      expect(result.record?.status).toBe("ignored");
      expect(writer.writeFields).toHaveBeenCalledWith(
        expect.objectContaining({ "标题": "新标题不应该覆盖旧记录", "去重 ID": "aweme:7650000000000000000" }),
        { updateFieldsIfExisting: { "处理状态": "ignored" } },
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
