import { describe, expect, it } from "vitest";
import { vi } from "vitest";
import * as analysisModule from "../../src/analysis/contentAnalysis.js";

const {
  buildAnalysisSystemPrompt,
  buildArticleAnalysisSystemPrompt,
  parseAndValidateAnalysis,
} = analysisModule;

const valid = {
  summary: "忠实原文的摘要",
  key_points: ["收藏内容可定时整理"],
  primary_category: "Skill/插件/模型",
  secondary_category: "知识库自动化/信息收集",
  useful_information: ["通过定时任务把收藏沉淀为可检索文档。"],
  action_items: ["检查每日任务"],
  transcript_corrections: [{ original: "skyo", suggested: "Skill", reason: "结合标题与上下文" }],
  quality_warnings: [],
  source_record_id: "rec1",
  source_platform: "抖音",
  processor: "local-ai-analysis",
  model: "deepseek-chat",
  processor_version: "1.0.0",
};

describe("content analysis schema", () => {
  it("keeps article instructions separate from the Douyin ASR prompt", () => {
    const douyin = buildAnalysisSystemPrompt(["其他"]); const article = buildArticleAnalysisSystemPrompt(["其他"]);
    expect(article).toContain("公众号文章"); expect(article).toContain("原文正文"); expect(article).not.toContain("Whisper"); expect(douyin).toContain("Whisper");
  });
  it("validates string[] useful_information", () => {
    expect(parseAndValidateAnalysis("```json\n" + JSON.stringify(valid) + "\n```", {
      recordId: "rec1", platform: "抖音", model: "deepseek-chat", primaryCategories: ["Skill/插件/模型", "其他"],
    })).toMatchObject({ useful_information: ["通过定时任务把收藏沉淀为可检索文档。"] });
  });

  it("converts single string useful_information to array", () => {
    const raw = { ...valid, useful_information: "单条信息文本" };
    expect(parseAndValidateAnalysis(JSON.stringify(raw), {
      recordId: "rec1", platform: "抖音", model: "deepseek-chat", primaryCategories: ["Skill/插件/模型"],
    })).toMatchObject({ useful_information: ["单条信息文本"] });
  });

  it("extracts leaf strings from nested object useful_information", () => {
    const raw = { ...valid, useful_information: { tools: { A: "工具A说明", B: "工具B说明" }, tip: "关键技巧" } };
    const result = parseAndValidateAnalysis(JSON.stringify(raw), {
      recordId: "rec1", platform: "抖音", model: "deepseek-chat", primaryCategories: ["Skill/插件/模型"],
    });
    expect(result.useful_information).toContain("工具A说明");
    expect(result.useful_information).toContain("工具B说明");
    expect(result.useful_information).toContain("关键技巧");
    expect(result.useful_information.length).toBeGreaterThanOrEqual(3);
  });

  it("accepts empty useful_information when no usable info exists", () => {
    expect(parseAndValidateAnalysis(JSON.stringify({ ...valid, useful_information: [] }), {
      recordId: "rec1", platform: "抖音", model: "deepseek-chat", primaryCategories: ["Skill/插件/模型"],
    })).toMatchObject({ useful_information: [] });
  });

  it("normalizes empty object and null useful_information to an empty array", () => {
    expect(parseAndValidateAnalysis(JSON.stringify({ ...valid, useful_information: {} }), {
      recordId: "rec1", platform: "抖音", model: "deepseek-chat", primaryCategories: ["Skill/插件/模型"],
    })).toMatchObject({ useful_information: [] });
    expect(parseAndValidateAnalysis(JSON.stringify({ ...valid, useful_information: null }), {
      recordId: "rec1", platform: "抖音", model: "deepseek-chat", primaryCategories: ["Skill/插件/模型"],
    })).toMatchObject({ useful_information: [] });
  });

  it("extracts useful information nested inside arrays and objects", () => {
    const raw = { ...valid, useful_information: { items: ["技巧A", { detail: "技巧B" }, 42] } };
    expect(parseAndValidateAnalysis(JSON.stringify(raw), {
      recordId: "rec1", platform: "抖音", model: "deepseek-chat", primaryCategories: ["Skill/插件/模型"],
    })).toMatchObject({ useful_information: ["技巧A", "技巧B"] });
  });

  it("rejects invalid JSON with a diagnostic error", () => {
    expect(() => parseAndValidateAnalysis("```json\n{broken}\n```", {
      recordId: "rec1", platform: "抖音", model: "deepseek-chat", primaryCategories: ["其他"],
    })).toThrow("analysis_json_invalid");
  });

  it("rejects a category outside current Base options", () => {
    expect(() => parseAndValidateAnalysis(JSON.stringify({ ...valid, primary_category: "无限新增分类" }), {
      recordId: "rec1", platform: "抖音", model: "deepseek-chat", primaryCategories: ["Skill/插件/模型", "其他"],
    })).toThrow("analysis_schema_invalid:primary_category");
  });

  it("binds provenance fields to trusted worker context instead of model echoes", () => {
    const result = parseAndValidateAnalysis(JSON.stringify({
      ...valid,
      source_record_id: "other",
      source_platform: "other-platform",
      processor: "other-processor",
      model: "other-model",
      processor_version: "other-version",
    }), {
      recordId: "rec1", platform: "抖音", model: "deepseek-chat", primaryCategories: ["Skill/插件/模型"],
    });
    expect(result).toMatchObject({
      source_record_id: "rec1",
      source_platform: "抖音",
      processor: "local-ai-analysis",
      model: "deepseek-chat",
      processor_version: "1.0.0",
    });
  });

  it("drops incomplete transcript corrections instead of failing the whole analysis", () => {
    const raw = {
      ...valid,
      transcript_corrections: [
        valid.transcript_corrections[0],
        { original: "错误词", suggested: "", reason: "缺少可靠建议" },
        { original: "另一个词", reason: "没有 suggested" },
      ],
    };
    expect(parseAndValidateAnalysis(JSON.stringify(raw), {
      recordId: "rec1", platform: "抖音", model: "deepseek-chat", primaryCategories: ["Skill/插件/模型"],
    }).transcript_corrections).toEqual([valid.transcript_corrections[0]]);
  });

  it("repairs one invalid model response and validates the second response", async () => {
    type CompleteValidatedAnalysis = (
      client: { completeJson(prompt: string, payload: unknown): Promise<string> },
      systemPrompt: string,
      payload: unknown,
      context: { recordId: string; platform: string; model: string; primaryCategories: string[] },
    ) => Promise<typeof valid>;
    const completeValidatedAnalysis = (analysisModule as typeof analysisModule & {
      completeValidatedAnalysis?: CompleteValidatedAnalysis;
    }).completeValidatedAnalysis;
    expect(typeof completeValidatedAnalysis).toBe("function");
    if (!completeValidatedAnalysis) return;

    const client = {
      completeJson: vi.fn()
        .mockResolvedValueOnce("{broken}")
        .mockResolvedValueOnce(JSON.stringify({ ...valid, source_record_id: "wrong" })),
    };
    await expect(completeValidatedAnalysis(client, "system prompt", { transcript: "正文" }, {
      recordId: "rec1", platform: "抖音", model: "deepseek-chat", primaryCategories: ["Skill/插件/模型"],
    })).resolves.toMatchObject({ source_record_id: "rec1", summary: "忠实原文的摘要" });
    expect(client.completeJson).toHaveBeenCalledTimes(2);
    expect(client.completeJson.mock.calls[1]?.[1]).toMatchObject({
      validation_error: "analysis_json_invalid",
      previous_response: "{broken}",
    });
  });

  it("stops after one repair attempt when both responses are invalid", async () => {
    type CompleteValidatedAnalysis = (
      client: { completeJson(prompt: string, payload: unknown): Promise<string> },
      systemPrompt: string,
      payload: unknown,
      context: { recordId: string; platform: string; model: string; primaryCategories: string[] },
    ) => Promise<typeof valid>;
    const completeValidatedAnalysis = (analysisModule as typeof analysisModule & {
      completeValidatedAnalysis?: CompleteValidatedAnalysis;
    }).completeValidatedAnalysis;
    expect(typeof completeValidatedAnalysis).toBe("function");
    if (!completeValidatedAnalysis) return;

    const client = { completeJson: vi.fn().mockResolvedValue("{broken}") };
    await expect(completeValidatedAnalysis(client, "system prompt", { transcript: "正文" }, {
      recordId: "rec1", platform: "抖音", model: "deepseek-chat", primaryCategories: ["Skill/插件/模型"],
    })).rejects.toThrow("analysis_json_invalid");
    expect(client.completeJson).toHaveBeenCalledTimes(2);
  });
});
