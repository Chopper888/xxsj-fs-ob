export interface TranscriptCorrection {
  original: string;
  suggested: string;
  reason: string;
}

export interface ContentAnalysisResult {
  summary: string;
  key_points: string[];
  primary_category: string;
  secondary_category: string;
  useful_information: string[];
  action_items: string[];
  transcript_corrections: TranscriptCorrection[];
  quality_warnings: string[];
  source_record_id: string;
  source_platform: string;
  processor: string;
  model: string;
  processor_version: string;
}

export interface AnalysisValidationContext {
  recordId: string;
  platform: string;
  model: string;
  primaryCategories: string[];
}

function invalid(field: string): never {
  throw new Error(`analysis_schema_invalid:${field}`);
}

function requireString(value: unknown, field: string, allowEmpty = false): string {
  if (typeof value !== "string" || (!allowEmpty && !value.trim())) invalid(field);
  return value as string;
}

function requireStrings(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) invalid(field);
  return value as string[];
}

function requireUsefulInformation(value: unknown): string[] {
  if (Array.isArray(value)) {
    const items = value.filter((v): v is string => typeof v === "string").map((s) => s.trim()).filter(Boolean);
    if (!items.length) invalid("useful_information");
    return [...new Set(items)];
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) invalid("useful_information");
    return [trimmed];
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const leaves = extractLeafStrings(value as Record<string, unknown>);
    if (!leaves.length) invalid("useful_information");
    return [...new Set(leaves)];
  }
  invalid("useful_information");
}

function extractLeafStrings(obj: Record<string, unknown>): string[] {
  const result: string[] = [];
  for (const [, v] of Object.entries(obj)) {
    if (typeof v === "string") { const t = v.trim(); if (t) result.push(t); }
    else if (v && typeof v === "object" && !Array.isArray(v)) result.push(...extractLeafStrings(v as Record<string, unknown>));
  }
  return result;
}

export function parseAndValidateAnalysis(raw: string, context: AnalysisValidationContext): ContentAnalysisResult {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  let value: unknown;
  try {
    value = JSON.parse((fenced?.[1] ?? raw).trim());
  } catch {
    throw new Error("analysis_json_invalid");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid("root");
  const input = value as Record<string, unknown>;
  const primary = requireString(input.primary_category, "primary_category");
  if (!context.primaryCategories.includes(primary)) invalid("primary_category");
  const corrections = input.transcript_corrections;
  if (!Array.isArray(corrections)) invalid("transcript_corrections");
  const normalizedCorrections = corrections.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) invalid(`transcript_corrections.${index}`);
    const object = item as Record<string, unknown>;
    return {
      original: requireString(object.original, `transcript_corrections.${index}.original`),
      suggested: requireString(object.suggested, `transcript_corrections.${index}.suggested`),
      reason: requireString(object.reason ?? object.context, `transcript_corrections.${index}.reason`),
    };
  });
  if (input.source_record_id !== context.recordId) invalid("source_record_id");
  if (input.source_platform !== context.platform) invalid("source_platform");
  if (input.model !== context.model) invalid("model");
  if (input.processor !== "local-ai-analysis") invalid("processor");
  return {
    summary: requireString(input.summary, "summary"),
    key_points: requireStrings(input.key_points, "key_points"),
    primary_category: primary,
    secondary_category: requireString(input.secondary_category, "secondary_category", true),
    useful_information: requireUsefulInformation(input.useful_information),
    action_items: requireStrings(input.action_items, "action_items"),
    transcript_corrections: normalizedCorrections,
    quality_warnings: requireStrings(input.quality_warnings, "quality_warnings"),
    source_record_id: context.recordId,
    source_platform: context.platform,
    processor: "local-ai-analysis",
    model: context.model,
    processor_version: requireString(input.processor_version, "processor_version"),
  };
}

export function buildAnalysisSystemPrompt(primaryCategories: string[]): string {
  return [
    "你是本地知识库的信息整理器。只输出一个JSON对象，不输出解释或Markdown。",
    "所有结论必须忠于输入中的标题、元数据和Whisper转写；禁止补充来源中不存在的事实。",
    `primary_category必须且只能从这些选项选择：${JSON.stringify(primaryCategories)}。`,
    "secondary_category应复用现有值或给出一个克制的建议，不扩展分类体系。",
    "无法确认时使用空字符串、空数组，并写入quality_warnings。转写纠错必须提供原文、建议和上下文依据。",
    "必填字段及类型：summary字符串；key_points字符串数组；primary_category字符串；secondary_category字符串；useful_information字符串或字符串值对象；action_items字符串数组；quality_warnings字符串数组。",
    "transcript_corrections必须是对象数组，每项严格包含original、suggested、reason三个字符串字段；没有可靠纠错时返回空数组。",
    "还必须原样返回source_record_id、source_platform、model，并返回processor和processor_version。",
    "processor固定为local-ai-analysis，processor_version固定为1.0.0。",
  ].join("\n");
}

export function buildArticleAnalysisSystemPrompt(primaryCategories: string[]): string {
  return [
    "你是本地知识库的公众号文章分析器。只输出一个 JSON 对象，不输出解释或 Markdown。",
    "输入 primaryText 是已经验证的公众号原文正文。必须忠于标题、作者、发布时间和原文正文，禁止补充来源中不存在的事实。",
    "AI 摘要与要点是分析结果，不得冒充或改写为原文。transcript_corrections 对文章固定返回空数组。",
    `primary_category 必须且只能从这些选项选择：${JSON.stringify(primaryCategories)}。`,
    "必填字段及类型：summary 字符串；key_points 字符串数组；primary_category 字符串；secondary_category 字符串；useful_information 字符串数组；action_items 字符串数组；transcript_corrections 空数组；quality_warnings 字符串数组。",
    "还必须原样返回 source_record_id、source_platform、model，并返回 processor 和 processor_version。",
    "processor 固定为 local-ai-analysis，processor_version 固定为 1.0.0。",
  ].join("\n");
}
