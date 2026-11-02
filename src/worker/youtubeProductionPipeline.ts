import type { ContentAnalysisResult } from "../analysis/contentAnalysis.js";
import type { NoteWriteResult } from "../obsidian/noteWriter.js";
import { prepareContent, toAnalysisInput, type ContentPreparationDependencies } from "../platform/contentPreparation.js";
import { loadNormalizedContentCache, saveNormalizedContentCache } from "../platform/sourceCache.js";
import type { AnalysisInput, NormalizedContent } from "../platform/types.js";
import { buildYouTubeMarkdown } from "../platform/youtube/youtubeMarkdown.js";
import { buildYouTubeIdentity } from "../platform/youtube/youtubeUrl.js";

export const YOUTUBE_MONITOR_STAGES = ["claim", "resolve", "acquire", "prepare_content", "deepseek", "markdown", "obsidian", "base_done"] as const;
type Stage = (typeof YOUTUBE_MONITOR_STAGES)[number];

export interface YouTubePipelineInput {
  recordId: string;
  taskDir: string;
  sourceUrl: string;
  declaredPlatform: string;
  title: string;
  vaultPath: string;
}

export interface YouTubePipelineDeps extends ContentPreparationDependencies {
  resolveContent(): Promise<NormalizedContent>;
  analyze(input: AnalysisInput, mode: "subtitle-first" | "media-first"): Promise<ContentAnalysisResult>;
  writeNote(input: { targetDir: "YouTube"; title: string; workId: string; content: string; vaultPath: string; recordId: string }): Promise<NoteWriteResult>;
  updateBase(fields: Record<string, unknown>): Promise<void>;
  setStage(stage: Stage, index: number): Promise<void>;
}

export async function runYouTubeProductionPipeline(
  input: YouTubePipelineInput,
  deps: YouTubePipelineDeps,
): Promise<{ preparationMode: "subtitle-first" | "media-first"; notePath: string }> {
  if (!input.vaultPath.trim()) throw new Error("obsidian_vault_path_required");
  const stage = async (name: Stage) => deps.setStage(name, YOUTUBE_MONITOR_STAGES.indexOf(name) + 1);
  await stage("claim");
  await stage("resolve");
  const identity = buildYouTubeIdentity(input.sourceUrl);
  let content = await loadNormalizedContentCache(input.taskDir, identity).catch(() => null);
  await stage("acquire");
  if (!content) {
    content = await deps.resolveContent();
    await saveNormalizedContentCache(input.taskDir, content);
  }
  await stage("prepare_content");
  const prepared = await prepareContent(content, deps);
  const mode = prepared.preparationMode === "subtitle-first" ? "subtitle-first" : "media-first";
  await stage("deepseek");
  const analysis = await deps.analyze(toAnalysisInput(input.recordId, prepared), mode);
  await stage("markdown");
  const markdown = buildYouTubeMarkdown({ recordId: input.recordId, content, prepared, analysis, processedAt: new Date().toISOString() });
  await stage("obsidian");
  const note = await deps.writeNote({
    targetDir: "YouTube",
    title: content.title ?? input.title,
    workId: content.identity.platformContentId,
    content: markdown,
    vaultPath: input.vaultPath,
    recordId: input.recordId,
  });
  if (!note.success) throw new Error(note.error ?? "obsidian_write_failed");
  await stage("base_done");
  await deps.updateBase({ "处理状态": "done", "知识库路径": note.finalPath, "处理时间": Date.now() });
  return { preparationMode: mode, notePath: note.finalPath };
}
