import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runXProductionPipeline, type XDeps } from "../../src/worker/xProductionPipeline.js";
import { buildXIdentity } from "../../src/platform/x/xUrl.js";
import type { NormalizedContent } from "../../src/platform/types.js";

function videoPostContent(media: NormalizedContent["media"]): NormalizedContent {
  return {
    identity: buildXIdentity("https://x.com/alice/status/123"),
    contentType: "post",
    title: "视频推文",
    author: { name: "Alice" },
    publishedAt: "2026-08-14",
    texts: [{ kind: "body", role: "primary", text: "正文" }],
    media,
    links: [],
    sourceMetadata: { handle: "alice" },
  };
}

const analysis = {
  summary: "摘要", key_points: ["要点"], primary_category: "其他", secondary_category: "",
  useful_information: ["信息"], action_items: [], transcript_corrections: [],
  quality_warnings: [], source_record_id: "rec", source_platform: "推特",
  processor: "local-ai-analysis", model: "m", processor_version: "1.0.0",
};

function buildDeps(content: NormalizedContent) {
  const materializeMedia = vi.fn();
  const transcribe = vi.fn();
  const writeNote = vi.fn();
  const deps = {
    resolveContent: vi.fn(async () => content),
    materializeMedia,
    transcribe,
    materializeImages: vi.fn(async () => ({ assets: [], warnings: [] })),
    persistImages: vi.fn(async (_c: NormalizedContent, r: { assets: []; warnings: [] }) => r),
    analyze: vi.fn(async () => analysis),
    writeNote,
    updateBase: vi.fn(async () => {}),
    setStage: vi.fn(async () => {}),
  } as unknown as XDeps;
  return { deps, materializeMedia, transcribe, writeNote };
}

describe("runXProductionPipeline 视频转录接入", () => {
  it("含视频的推文：下载视频 + 转录，逐字稿并入笔记", async () => {
    const taskDir = mkdtempSync(join(tmpdir(), "xp-video-"));
    try {
      const { deps, materializeMedia, transcribe, writeNote } = buildDeps(videoPostContent([{ kind: "video", role: "primary", sourceUrl: "https://v/a.mp4", mimeType: "video/mp4" }]));
      materializeMedia.mockResolvedValue([{ kind: "video", localPath: join(taskDir, "media", "source.mp4"), mediaUrl: "https://v/a.mp4", bytes: 10 }]);
      transcribe.mockResolvedValue({ text: "这是转录文本", provider: "mock-asr" });
      writeNote.mockResolvedValue({ success: true, finalPath: "note.md", hash: "h", conflict: "none" });

      const result = await runXProductionPipeline({ recordId: "rec", taskDir, sourceUrl: "https://x.com/alice/status/123", declaredPlatform: "推特", title: "视频推文", vaultPath: "C:/vault" }, deps);

      expect(materializeMedia).toHaveBeenCalledTimes(1);
      expect(transcribe).toHaveBeenCalledTimes(1);
      expect(transcribe).toHaveBeenCalledWith([{ kind: "video", localPath: join(taskDir, "media", "source.mp4"), mediaUrl: "https://v/a.mp4", bytes: 10 }]);
      const noteInput = writeNote.mock.calls[0][0];
      expect(noteInput.targetDir).toBe("推特");
      expect(noteInput.content).toContain("## 视频逐字稿");
      expect(noteInput.content).toContain("这是转录文本");
      expect(noteInput.content).toContain("> 逐字稿来源：mock-asr 可读化结果，未经人工校正");
      expect(result.notePath).toBe("note.md");
    } finally {
      rmSync(taskDir, { recursive: true, force: true });
    }
  });

  it("无视频的推文：不触发下载与转录", async () => {
    const taskDir = mkdtempSync(join(tmpdir(), "xp-text-"));
    try {
      const { deps, materializeMedia, transcribe, writeNote } = buildDeps(videoPostContent([]));
      writeNote.mockResolvedValue({ success: true, finalPath: "note.md", hash: "h", conflict: "none" });

      await runXProductionPipeline({ recordId: "rec", taskDir, sourceUrl: "https://x.com/alice/status/123", declaredPlatform: "推特", title: "推文", vaultPath: "C:/vault" }, deps);

      expect(materializeMedia).not.toHaveBeenCalled();
      expect(transcribe).not.toHaveBeenCalled();
      const noteInput = writeNote.mock.calls[0][0];
      expect(noteInput.content).not.toContain("视频逐字稿");
    } finally {
      rmSync(taskDir, { recursive: true, force: true });
    }
  });
});
