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
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? [trimmed] : [];
  }
  if (value && typeof value === "object") return [...new Set(extractLeafStrings(value))];
  return [];
}

function extractLeafStrings(value: unknown): string[] {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? [trimmed] : [];
  }
  if (Array.isArray(value)) return value.flatMap(extractLeafStrings);
  if (!value || typeof value !== "object") return [];
  const result: string[] = [];
  for (const nested of Object.values(value as Record<string, unknown>)) result.push(...extractLeafStrings(nested));
  return result;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function normalizeTranscriptCorrections(value: unknown): TranscriptCorrection[] {
  if (!Array.isArray(value)) invalid("transcript_corrections");
  return value.flatMap((item): TranscriptCorrection[] => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const object = item as Record<string, unknown>;
    const original = nonEmptyString(object.original);
    const suggested = nonEmptyString(object.suggested);
    const reason = nonEmptyString(object.reason ?? object.context);
    return original && suggested && reason ? [{ original, suggested, reason }] : [];
  });
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
  const normalizedCorrections = normalizeTranscriptCorrections(input.transcript_corrections);
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
    processor_version: "1.0.0",
  };
}

export interface AnalysisCompletionClient {
  completeJson(systemPrompt: string, payload: unknown): Promise<string>;
}

function isRepairableAnalysisError(error: unknown): error is Error {
  return error instanceof Error && /^analysis_(?:json_invalid|schema_invalid:)/.test(error.message);
}

export async function completeValidatedAnalysis(
  client: AnalysisCompletionClient,
  systemPrompt: string,
  payload: unknown,
  context: AnalysisValidationContext,
): Promise<ContentAnalysisResult> {
  let prompt = systemPrompt;
  let requestPayload = payload;
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= 2; attempt++) {
    const raw = await client.completeJson(prompt, requestPayload);
    try {
      return parseAndValidateAnalysis(raw, context);
    } catch (error) {
      if (!isRepairableAnalysisError(error) || attempt === 2) throw error;
      lastError = error;
      prompt = [
        systemPrompt,
        "上一次响应未通过本地结构校验。请根据 validation_error 修复并重新输出完整 JSON。",
        "不要解释，不要输出 Markdown，不要省略必填字段。",
      ].join("\n");
      requestPayload = {
        original_payload: payload,
        previous_response: raw,
        validation_error: error.message,
        trusted_provenance: {
          source_record_id: context.recordId,
          source_platform: context.platform,
          processor: "local-ai-analysis",
          model: context.model,
          processor_version: "1.0.0",
        },
      };
    }
  }

  throw lastError ?? new Error("analysis_validation_failed");
}

export function buildAnalysisSystemPrompt(primaryCategories: string[]): string {
  return [
    "你是本地知识库的信息整理器。只输出一个JSON对象，不输出解释或Markdown。",
    "所有结论必须忠于输入中的标题、元数据和Whisper转写；禁止补充来源中不存在的事实。",
    `primary_category必须且只能从这些选项选择：${JSON.stringify(primaryCategories)}。`,
    "secondary_category应复用现有值或给出一个克制的建议，不扩展分类体系。",
    "无法确认时使用空字符串、空数组，并写入quality_warnings。转写纠错必须提供原文、建议和上下文依据。",
    "必填字段及类型：summary字符串；key_points字符串数组；primary_category字符串；secondary_category字符串；useful_information字符串数组；action_items字符串数组；quality_warnings字符串数组。没有值得保存的信息时useful_information返回空数组。",
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

export function buildVideoAnalysisSystemPrompt(primaryCategories:string[],mode:"subtitle-first"|"media-first"):string{return["你是本地知识库的 B站视频分析器。只输出一个 JSON 对象，不输出解释或 Markdown。",mode==="subtitle-first"?"输入 primaryText 来自公开官方字幕，不是 ASR；必须忠于字幕和视频元数据。":"输入 primaryText 来自 ASR 转写；可依据上下文识别转写错误，但不得补充来源中不存在的事实。",`primary_category 必须且只能从这些选项选择：${JSON.stringify(primaryCategories)}。`,"必填字段与现有分析 schema 完全一致；还必须原样返回 source_record_id、source_platform、model、processor、processor_version。","processor 固定为 local-ai-analysis，processor_version 固定为 1.0.0。"].join("\n")}
export function buildYouTubeVideoAnalysisSystemPrompt(primaryCategories: string[], mode: "subtitle-first" | "media-first"): string {
  return [
    "你是本地知识库的 YouTube 视频分析器。只输出一个 JSON 对象，不输出解释或 Markdown。",
    mode === "subtitle-first"
      ? "输入 primaryText 来自官方字幕，不是 ASR；必须忠于字幕和视频元数据。transcript_corrections 固定返回空数组（官方字幕无需纠错）。"
      : "输入 primaryText 来自 ASR 转写；可依据上下文识别转写错误，但不得补充来源中不存在的事实。transcript_corrections 必须是对象数组，每项严格包含 original、suggested、reason 三个字符串字段；没有可靠纠错时返回空数组。",
    `primary_category 必须且只能从这些选项选择：${JSON.stringify(primaryCategories)}。`,
    "secondary_category 应复用现有值或给出一个克制的建议，不扩展分类体系。",
    "无法确认时使用空字符串、空数组，并写入 quality_warnings。",
    "必填字段及类型：summary 字符串；key_points 字符串数组；primary_category 字符串；secondary_category 字符串；useful_information 字符串数组；action_items 字符串数组；transcript_corrections 数组（规则见上）；quality_warnings 字符串数组。",
    "还必须原样返回 source_record_id、source_platform、model，并返回 processor 和 processor_version。",
    "processor 固定为 local-ai-analysis，processor_version 固定为 1.0.0。",
  ].join("\n");
}
export function buildSocialPostAnalysisSystemPrompt(primaryCategories:string[]):string{return["你是本地知识库的公开社交 Post 分析器。只输出一个 JSON 对象，不输出解释或 Markdown。","输入 primaryText 是公开 Post 原始正文；必须忠于正文、作者和发布时间。不得根据 mediaHint 猜测图片或视频内容。transcript_corrections 固定返回空数组。",`primary_category 必须且只能从这些选项选择：${JSON.stringify(primaryCategories)}。`,"必填字段及类型：summary 字符串；key_points 字符串数组；primary_category 字符串；secondary_category 字符串；useful_information 字符串数组；action_items 字符串数组；transcript_corrections 空数组；quality_warnings 字符串数组。","还必须原样返回 source_record_id、source_platform、model、processor、processor_version。","processor 固定为 local-ai-analysis，processor_version 固定为 1.0.0。"].join("\n")}
