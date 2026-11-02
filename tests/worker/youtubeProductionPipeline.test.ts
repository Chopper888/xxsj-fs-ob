import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { runYouTubeProductionPipeline } from "../../src/worker/youtubeProductionPipeline.js";
import { buildYouTubeIdentity } from "../../src/platform/youtube/youtubeUrl.js";
import type { NormalizedContent } from "../../src/platform/types.js";
import type { NoteWriteResult } from "../../src/obsidian/noteWriter.js";

let taskDir: string;
beforeEach(async () => { taskDir = join(tmpdir(), `yt-pipeline-${randomUUID()}`); await mkdir(taskDir, { recursive: true }); });
afterEach(async () => rm(taskDir, { recursive: true, force: true }));

const subtitleContent: NormalizedContent = {
  identity: buildYouTubeIdentity("https://youtu.be/dQw4w9WgXcQ"),
  contentType: "video", title: "Rick Astley 官方 MV", author: { name: "RickAstleyVEVO" }, publishedAt: "2024-01-02T00:00:00.000Z",
  texts: [{ kind: "official_subtitle", role: "primary", text: "官方字幕内容（足够用于分析）。", language: "zh-Hans" }],
  media: [{ kind: "video", role: "context", sourceUrl: "https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg" }],
  links: [{ url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", role: "source" }],
  sourceMetadata: { subtitleAvailable: true, subtitleLanguage: "zh-Hans", acquisitionStrategy: "yt-dlp-subtitle-first" },
};

const mediaContent: NormalizedContent = {
  ...subtitleContent,
  texts: [{ kind: "caption", role: "context", text: "Rick Astley 官方 MV" }],
  media: [{ kind: "video", role: "primary", sourceUrl: "https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg" }],
  sourceMetadata: { subtitleAvailable: false, acquisitionStrategy: "yt-dlp-audio-asr" },
};

const analysis = { summary: "摘要", key_points: ["要点"], primary_category: "其他", secondary_category: "", useful_information: ["信息"], action_items: [], transcript_corrections: [], quality_warnings: [], source_record_id: "rec123", source_platform: "YouTube", processor: "local-ai-analysis", model: "deepseek-chat", processor_version: "1.0.0" };

function deps(resolveContent = vi.fn(async () => subtitleContent)) {
  return {
    resolveContent,
    materializeMedia: vi.fn(async () => [{ kind: "audio" as const, localPath: join(taskDir, "media", "source.mp4"), mediaUrl: "https://youtu.be/dQw4w9WgXcQ", bytes: 100 }]),
    transcribe: vi.fn(async () => ({ text: "ASR 转写内容", provider: "faster-whisper" })),
    analyze: vi.fn(async () => analysis),
    writeNote: vi.fn(async (note: { targetDir: string; title: string; workId: string; content: string; vaultPath: string; recordId: string }): Promise<NoteWriteResult> => ({ success: true, finalPath: "vault/YouTube/xx.md", hash: "h", conflict: "none" as const })),
    updateBase: vi.fn(async (_f: Record<string, unknown>) => {}),
    setStage: vi.fn(async (_s: string, _i: number) => {}),
  };
}
const input = () => ({ recordId: "rec123", taskDir, sourceUrl: "https://youtu.be/dQw4w9WgXcQ", declaredPlatform: "YouTube", title: "Rick Astley 官方 MV", vaultPath: "vault" });

describe("YouTube production pipeline", () => {
  it("官方字幕完成 subtitle-first，不下载音频、不转写", async () => {
    const d = deps();
    const r = await runYouTubeProductionPipeline(input(), d);
    expect(r.preparationMode).toBe("subtitle-first");
    expect(d.materializeMedia).not.toHaveBeenCalled();
    expect(d.transcribe).not.toHaveBeenCalled();
    expect(d.analyze).toHaveBeenCalledWith(expect.objectContaining({ primaryText: "官方字幕内容（足够用于分析）。" }), "subtitle-first");
    expect(d.writeNote).toHaveBeenCalledWith(expect.objectContaining({ targetDir: "YouTube", workId: "dQw4w9WgXcQ" }));
    expect(d.updateBase).toHaveBeenCalledWith(expect.objectContaining({ "处理状态": "done" }));
  });

  it("无字幕内容走 media-first：materialize + transcribe 后标注 ASR", async () => {
    const d = deps(vi.fn(async () => mediaContent));
    const r = await runYouTubeProductionPipeline(input(), d);
    expect(r.preparationMode).toBe("media-first");
    expect(d.materializeMedia).toHaveBeenCalledOnce();
    expect(d.transcribe).toHaveBeenCalledOnce();
    expect(d.analyze).toHaveBeenCalledWith(expect.objectContaining({ primaryText: "ASR 转写内容" }), "media-first");
    const note = d.writeNote.mock.calls[0][0];
    expect(note.content).toContain("## ASR 转写");
    expect(note.content).toContain("> 转录来源：ASR 转写");
  });

  it("AI 失败后 source cache 恢复不再请求 resolveContent", async () => {
    const a = deps(); a.analyze.mockRejectedValueOnce(new Error("ai_fail"));
    await expect(runYouTubeProductionPipeline(input(), a)).rejects.toThrow("ai_fail");
    const b = deps(vi.fn(async () => { throw new Error("resolve_must_not_run"); }));
    await runYouTubeProductionPipeline(input(), b);
    expect(b.resolveContent).not.toHaveBeenCalled();
  });

  it("Obsidian 写入失败时抛错且不标 done", async () => {
    const d = deps();
    d.writeNote.mockResolvedValue({ success: false, finalPath: "", hash: "h", error: "vault_lock", conflict: "existing_note_modified" });
    await expect(runYouTubeProductionPipeline(input(), d)).rejects.toThrow("vault_lock");
    expect(d.updateBase).not.toHaveBeenCalled();
  });
});
