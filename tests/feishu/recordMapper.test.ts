import { describe, expect, it } from "vitest";
import type { CaptureRecord } from "../../src/domain/types.js";
import { mapRecordToFeishuFields } from "../../src/feishu/recordMapper.js";

describe("mapRecordToFeishuFields", () => {
  it("maps capture records to Chinese Feishu field names", () => {
    const record: CaptureRecord = {
      type: "text",
      title: "RAG 评估",
      text: "正文",
      rawSnapshot: "{}",
      dedupeId: "text:abc",
      capturedAt: "2026-07-03T10:00:00.000Z",
      status: "summarized",
      summary: {
        summary: "摘要",
        suggestedCategory: "AI",
      },
    };

    expect(mapRecordToFeishuFields(record)).toEqual({
      "标题": "RAG 评估",
      "内容类型": "text",
      "原始链接": "",
      "原始文本": "正文",
      "作者/来源": "",
      "摘要": "摘要",
      "捕获时间": "2026-07-03 10:00:00",
      "处理状态": "summarized",
      "去重 ID": "text:abc",
      "错误信息": "",
      "知识库链接": "",
    });
  });

  it("maps video share-card authors to author/source instead of original text", () => {
    const record: CaptureRecord = {
      type: "video",
      title: "键盘消失转场效果教学 #剪辑教程",
      url: "https://www.douyin.com/jingxuan?modal_id=7650000000000000000",
      text: "",
      author: "示例作者",
      rawSnapshot: "{}",
      dedupeId: "aweme:765",
      capturedAt: "2026-07-03T10:00:00.000Z",
      status: "recorded",
    };

    expect(mapRecordToFeishuFields(record)).toMatchObject({
      "标题": "键盘消失转场效果教学 #剪辑教程",
      "原始链接": "https://www.douyin.com/jingxuan?modal_id=7650000000000000000",
      "原始文本": "",
      "作者/来源": "示例作者",
    });
  });
});
