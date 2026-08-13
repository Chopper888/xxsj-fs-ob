import { describe, expect, it, vi } from "vitest";
import { prepareContent, toAnalysisInput } from "../../src/platform/contentPreparation.js";
import type { NormalizedContent } from "../../src/platform/types.js";

function content(overrides: Partial<NormalizedContent>): NormalizedContent {
  return {
    identity: { platform: "douyin", platformContentId: "12345678", sourceUrl: "https://source", canonicalUrl: "https://canonical", dedupeKey: "aweme:12345678" },
    contentType: "video", texts: [], media: [], links: [], ...overrides,
  };
}

describe("content preparation contracts", () => {
  it("uses native primary body without media materialization or ASR", async () => {
    const materializeMedia = vi.fn(); const transcribe = vi.fn();
    const prepared = await prepareContent(content({ contentType: "article", texts: [{ kind: "body", role: "primary", text: "Article body" }] }), { materializeMedia, transcribe });
    expect(prepared.preparationMode).toBe("text-first");
    expect(prepared.primaryText).toBe("Article body");
    expect(materializeMedia).not.toHaveBeenCalled(); expect(transcribe).not.toHaveBeenCalled();
  });

  it("prefers an official subtitle without invoking ASR", async () => {
    const transcribe = vi.fn();
    const prepared = await prepareContent(content({ texts: [{ kind: "caption", role: "context", text: "Caption" }, { kind: "official_subtitle", role: "primary", text: "Official subtitle" }] }), { materializeMedia: vi.fn(), transcribe });
    expect(prepared.preparationMode).toBe("subtitle-first");
    expect(prepared.primaryText).toBe("Official subtitle"); expect(transcribe).not.toHaveBeenCalled();
  });

  it("materializes media and transcribes when native analyzable text is absent", async () => {
    const materializeMedia = vi.fn().mockResolvedValue([{ kind: "video", localPath: "C:/tmp/source.mp4", mediaUrl: "https://media.example/video" }]);
    const transcribe = vi.fn().mockResolvedValue({ text: "ASR transcript", provider: "qwen-asr", segments: [] });
    const prepared = await prepareContent(content({ media: [{ kind: "video", role: "primary" }] }), { materializeMedia, transcribe });
    expect(prepared.preparationMode).toBe("media-first"); expect(prepared.primaryText).toBe("ASR transcript");
    expect(materializeMedia).toHaveBeenCalledTimes(1); expect(transcribe).toHaveBeenCalledTimes(1);
    expect(prepared.source.texts).toEqual([]);
  });

  it("maps PreparedContent to a platform-neutral AnalysisInput", async () => {
    const source = content({ title: "T", author: { name: "A" }, publishedAt: "2026-08-13", texts: [{ kind: "body", role: "primary", text: "Body" }] });
    const prepared = await prepareContent(source, { materializeMedia: vi.fn(), transcribe: vi.fn() });
    expect(toAnalysisInput("rec1234567890", prepared)).toMatchObject({ sourceRecordId: "rec1234567890", platform: "douyin", canonicalUrl: "https://canonical", title: "T", author: "A", primaryText: "Body" });
  });
});
