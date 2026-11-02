import type { ContentAnalysisResult } from "../analysis/contentAnalysis.js";
import type { NoteWriteResult } from "../obsidian/noteWriter.js";
import { prepareContent, toAnalysisInput, type ContentPreparationDependencies } from "../platform/contentPreparation.js";
import { loadNormalizedContentCache, saveNormalizedContentCache } from "../platform/sourceCache.js";
import type { AnalysisInput, NormalizedContent } from "../platform/types.js";
import { buildXMarkdown } from "../platform/x/xMarkdown.js";
import { buildXIdentity } from "../platform/x/xUrl.js";
import type { WechatAssetResult } from "../platform/wechat/wechatAssetMaterializer.js";

export const X_MONITOR_STAGES = ["claim", "resolve", "acquire", "prepare_content", "deepseek", "markdown", "obsidian", "base_done"] as const;
type Stage = (typeof X_MONITOR_STAGES)[number];

export interface XInput { recordId: string; taskDir: string; sourceUrl: string; declaredPlatform: string; title: string; vaultPath: string }

export interface XDeps extends ContentPreparationDependencies {
  resolveContent(): Promise<NormalizedContent>;
  analyze(input: AnalysisInput): Promise<ContentAnalysisResult>;
  materializeImages(content: NormalizedContent): Promise<WechatAssetResult>;
  persistImages(content: NormalizedContent, result: WechatAssetResult): Promise<WechatAssetResult>;
  writeNote(input: { targetDir: "推特"; title: string; workId: string; content: string; vaultPath: string; recordId: string }): Promise<NoteWriteResult>;
  updateBase(fields: Record<string, unknown>): Promise<void>;
  setStage(stage: Stage, index: number): Promise<void>;
}

export async function runXProductionPipeline(input: XInput, deps: XDeps): Promise<{ preparationMode: "text-first"; warnings: string[]; notePath: string }> {
  if (!input.vaultPath.trim()) throw new Error("obsidian_vault_path_required");
  const stage = async (name: Stage) => deps.setStage(name, X_MONITOR_STAGES.indexOf(name) + 1);
  await stage("claim");
  await stage("resolve");
  const identity = buildXIdentity(input.sourceUrl);
  let content = await loadNormalizedContentCache(input.taskDir, identity).catch(() => null);
  await stage("acquire");
  if (!content) { content = await deps.resolveContent(); await saveNormalizedContentCache(input.taskDir, content); }
  await stage("prepare_content");
  const prepared = await prepareContent(content, deps);
  if (prepared.preparationMode !== "text-first") throw new Error("x_text_first_required");
  // 视频是转录素材：推文正文为主（text-first），视频额外下载+转录，逐字稿并入笔记。
  let transcript: { text: string; provider: string; segments?: unknown[] } | undefined;
  if (content.media.some(m => m.kind === "video")) {
    const materialized = await deps.materializeMedia(content);
    transcript = await deps.transcribe(materialized);
  }
  const downloadedAssets = await deps.materializeImages(content);
  const assets = await deps.persistImages(content, downloadedAssets);
  await stage("deepseek");
  const analysis = await deps.analyze(toAnalysisInput(input.recordId, prepared));
  await stage("markdown");
  const markdown = buildXMarkdown({ recordId: input.recordId, content, analysis, assets: assets.assets, warnings: assets.warnings, processedAt: new Date().toISOString(), transcript: transcript ? { text: transcript.text, provider: transcript.provider } : undefined });
  await stage("obsidian");
  const note = await deps.writeNote({ targetDir: "推特", title: `${content.author?.name ?? input.title} Post`, workId: content.identity.platformContentId, content: markdown, vaultPath: input.vaultPath, recordId: input.recordId });
  if (!note.success) throw new Error(note.error ?? "obsidian_write_failed");
  await stage("base_done");
  await deps.updateBase({ "处理状态": "done", "知识库路径": note.finalPath, "处理时间": Date.now() });
  return { preparationMode: "text-first", warnings: assets.warnings, notePath: note.finalPath };
}
