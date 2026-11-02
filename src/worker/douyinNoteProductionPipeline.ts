import type { ContentAnalysisResult } from "../analysis/contentAnalysis.js";
import type { NoteWriteResult } from "../obsidian/noteWriter.js";
import { prepareContent, toAnalysisInput, type ContentPreparationDependencies } from "../platform/contentPreparation.js";
import { buildDouyinNoteMarkdown } from "../platform/douyin/douyinNoteMarkdown.js";
import { loadNormalizedContentCache, saveNormalizedContentCache } from "../platform/sourceCache.js";
import type { AnalysisInput, NormalizedContent, PlatformIdentity } from "../platform/types.js";
import type { WechatAssetResult } from "../platform/wechat/wechatAssetMaterializer.js";

export const DOUYIN_NOTE_MONITOR_STAGES = ["claim", "resolve", "acquire", "prepare_content", "deepseek", "markdown", "obsidian", "base_done"] as const;
type Stage = (typeof DOUYIN_NOTE_MONITOR_STAGES)[number];

export interface DouyinNoteInput { recordId: string; taskDir: string; sourceUrl: string; declaredPlatform: string; title: string; vaultPath: string }
export interface DouyinNoteDeps extends ContentPreparationDependencies {
  resolveContent(): Promise<NormalizedContent>;
  analyze(input: AnalysisInput): Promise<ContentAnalysisResult>;
  materializeImages(content: NormalizedContent): Promise<WechatAssetResult>;
  persistImages(content: NormalizedContent, result: WechatAssetResult): Promise<WechatAssetResult>;
  writeNote(input: { targetDir: "抖音"; title: string; workId: string; content: string; vaultPath: string; recordId: string }): Promise<NoteWriteResult>;
  updateBase(fields: Record<string, unknown>): Promise<void>;
  setStage(stage: Stage, index: number): Promise<void>;
}

export async function runDouyinNoteProductionPipeline(input: DouyinNoteInput, deps: DouyinNoteDeps): Promise<{ preparationMode: "text-first"; warnings: string[]; notePath: string }> {
  if (!input.vaultPath.trim()) throw new Error("obsidian_vault_path_required");
  const stage = async (name: Stage) => deps.setStage(name, DOUYIN_NOTE_MONITOR_STAGES.indexOf(name) + 1);
  await stage("claim");
  await stage("resolve");
  const identity: PlatformIdentity = { platform: "douyin", platformContentId: "", sourceUrl: input.sourceUrl, canonicalUrl: input.sourceUrl, dedupeKey: `douyin:${input.sourceUrl.match(/\/(?:note|article|video)\/(\d{8,})/)?.[1] ?? ""}` };
  let content = await loadNormalizedContentCache(input.taskDir, identity).catch(() => null);
  await stage("acquire");
  if (!content) { content = await deps.resolveContent(); await saveNormalizedContentCache(input.taskDir, content); }
  await stage("prepare_content");
  const prepared = await prepareContent(content, deps);
  if (prepared.preparationMode !== "text-first") throw new Error("douyin_note_text_first_required");
  const downloadedAssets = await deps.materializeImages(content);
  const assets = await deps.persistImages(content, downloadedAssets);
  await stage("deepseek");
  const analysis = await deps.analyze(toAnalysisInput(input.recordId, prepared));
  await stage("markdown");
  const markdown = buildDouyinNoteMarkdown({ recordId: input.recordId, content, analysis, assets: assets.assets, warnings: assets.warnings, processedAt: new Date().toISOString() });
  await stage("obsidian");
  const note = await deps.writeNote({ targetDir: "抖音", title: content.title ?? input.title, workId: content.identity.platformContentId, content: markdown, vaultPath: input.vaultPath, recordId: input.recordId });
  if (!note.success) throw new Error(note.error ?? "obsidian_write_failed");
  await stage("base_done");
  await deps.updateBase({ "处理状态": "done", "知识库路径": note.finalPath, "处理时间": Date.now() });
  return { preparationMode: "text-first", warnings: assets.warnings, notePath: note.finalPath };
}
