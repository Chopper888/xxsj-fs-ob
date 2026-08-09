import { describe, expect, it } from "vitest";
import { parseAndValidateAnalysis } from "../../src/analysis/contentAnalysis.js";

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

  it("rejects empty useful_information", () => {
    expect(() => parseAndValidateAnalysis(JSON.stringify({ ...valid, useful_information: [] }), {
      recordId: "rec1", platform: "抖音", model: "deepseek-chat", primaryCategories: ["Skill/插件/模型"],
    })).toThrow("analysis_schema_invalid:useful_information");
  });

  it("rejects empty object useful_information", () => {
    expect(() => parseAndValidateAnalysis(JSON.stringify({ ...valid, useful_information: {} }), {
      recordId: "rec1", platform: "抖音", model: "deepseek-chat", primaryCategories: ["Skill/插件/模型"],
    })).toThrow("analysis_schema_invalid:useful_information");
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

  it("rejects spoofed provenance fields", () => {
    expect(() => parseAndValidateAnalysis(JSON.stringify({ ...valid, source_record_id: "other" }), {
      recordId: "rec1", platform: "抖音", model: "deepseek-chat", primaryCategories: ["Skill/插件/模型"],
    })).toThrow("analysis_schema_invalid:source_record_id");
  });
});
