import type { ContentAnalysisResult } from "../analysis/contentAnalysis.js";
import { prepareContent, toAnalysisInput, type ContentPreparationDependencies } from "../platform/contentPreparation.js";
import { PlatformAdapterError } from "../platform/platformAdapter.js";
import { loadNormalizedContentCache, saveNormalizedContentCache } from "../platform/sourceCache.js";
import type { AnalysisInput, NormalizedContent, PlatformIdentity } from "../platform/types.js";
import { buildWechatArticleMarkdown } from "../platform/wechat/wechatArticleMarkdown.js";
import type { WechatAssetResult } from "../platform/wechat/wechatAssetMaterializer.js";
import { buildWechatIdentity } from "../platform/wechat/wechatUrl.js";
import type { NoteWriteResult } from "../obsidian/noteWriter.js";

export const WECHAT_MONITOR_STAGES = ["claim", "resolve", "acquire", "prepare_content", "deepseek", "markdown", "obsidian", "base_done"] as const;
export interface WechatPipelineInput { recordId: string; taskDir: string; sourceUrl: string; declaredPlatform: string; title: string; vaultPath: string }
export interface WechatPipelineDependencies extends ContentPreparationDependencies {
  resolveContent(): Promise<NormalizedContent>;
  analyze(input: AnalysisInput): Promise<ContentAnalysisResult>;
  materializeImages(content: NormalizedContent): Promise<WechatAssetResult>;
  persistImages(content: NormalizedContent, result: WechatAssetResult): Promise<WechatAssetResult>;
  writeNote(input: { targetDir: "公众号"; title: string; workId: string; content: string; vaultPath: string; recordId: string }): Promise<NoteWriteResult>;
  updateBase(fields: Record<string, unknown>): Promise<void>;
  setStage(stage: typeof WECHAT_MONITOR_STAGES[number], index: number): Promise<void>;
}
const TERMINAL = new Set(["article_deleted", "article_not_found", "unsupported_wechat_url", "invalid_url", "content_empty", "content_invalid"]);
const BOUNDED = new Set(["verification_required", "auth_required", "access_restricted"]);
const RETRYABLE = new Set(["temporary_network", "browser_timeout", "rate_limited"]);
export function classifyWechatProductionError(error: unknown): { retryable: boolean; terminal: boolean } {
  const code = error instanceof PlatformAdapterError ? error.code : "";
  if (TERMINAL.has(code)) return { retryable: false, terminal: true };
  if (BOUNDED.has(code)) return { retryable: false, terminal: false };
  return { retryable: RETRYABLE.has(code), terminal: false };
}

export async function runWechatProductionPipeline(input: WechatPipelineInput, deps: WechatPipelineDependencies): Promise<{ preparationMode: "text-first"; warnings: string[]; notePath: string }> {
  const stage = async (name: typeof WECHAT_MONITOR_STAGES[number]) => deps.setStage(name, WECHAT_MONITOR_STAGES.indexOf(name) + 1);
  await stage("claim"); await stage("resolve");
  let identity: PlatformIdentity | null = null;
  let content: NormalizedContent | null = null;
  try {
    identity = buildWechatIdentity(input.sourceUrl);
    content = await loadNormalizedContentCache(input.taskDir, identity);
  } catch {}
  await stage("acquire");
  if (!content) { content = await deps.resolveContent(); await saveNormalizedContentCache(input.taskDir, content); }
  await stage("prepare_content");
  const prepared = await prepareContent(content, deps); if (prepared.preparationMode !== "text-first") throw new Error("wechat_text_first_required");
  const downloadedAssets = await deps.materializeImages(content); const assets = await deps.persistImages(content, downloadedAssets);
  await stage("deepseek"); const analysis = await deps.analyze(toAnalysisInput(input.recordId, prepared));
  await stage("markdown"); const markdown = buildWechatArticleMarkdown({ recordId: input.recordId, content, analysis, assets: assets.assets, warnings: assets.warnings, processedAt: new Date().toISOString() });
  await stage("obsidian"); const note = await deps.writeNote({ targetDir: "公众号", title: content.title ?? input.title, workId: content.identity.platformContentId, content: markdown, vaultPath: input.vaultPath, recordId: input.recordId });
  if (!note.success) throw new Error(note.error ?? "obsidian_write_failed");
  await stage("base_done"); await deps.updateBase({ "处理状态": "done", "知识库路径": note.finalPath, "处理时间": Date.now() });
  return { preparationMode: "text-first", warnings: assets.warnings, notePath: note.finalPath };
}
