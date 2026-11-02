import { describe, expect, it, vi } from "vitest";
import { join } from "node:path";
import { DouyinAdapter } from "../../src/platform/douyin/douyinAdapter.js";

const signal = new AbortController().signal;
const context = { taskDir: "C:/synthetic/task", signal, logger: { info: vi.fn(), warn: vi.fn() } };

describe("DouyinAdapter compatibility", () => {
  it("recognizes video and canonical modal URLs but not other hosts", () => {
    const adapter = new DouyinAdapter();
    expect(adapter.canHandle({ sourceUrl: "https://www.douyin.com/video/7650000000000000000" })).toBe(true);
    expect(adapter.canHandle({ sourceUrl: "https://www.douyin.com/jingxuan?modal_id=7650000000000000000" })).toBe(true);
    expect(adapter.canHandle({ sourceUrl: "https://example.com/video/7650000000000000000" })).toBe(false);
  });

  it("normalizes canonical URL and keeps platform content ID separate from Base record ID", async () => {
    const adapter = new DouyinAdapter();
    const normalized = await adapter.normalizeUrl({ sourceUrl: "https://www.douyin.com/video/7650000000000000000", dedupeKey: "aweme:7650000000000000000" }, context);
    const identity = await adapter.resolveIdentity(normalized, context);
    expect(identity).toMatchObject({ platform: "douyin", platformContentId: "7650000000000000000", canonicalUrl: "https://www.douyin.com/jingxuan?modal_id=7650000000000000000", dedupeKey: "aweme:7650000000000000000" });
    expect(identity.platformContentId).not.toContain("rec");
  });

  it.each(["aweme:7650000000000000000", "douyin:7650000000000000000"])("preserves an existing dedupe key: %s", async (dedupeKey) => {
    const adapter = new DouyinAdapter();
    const normalized = await adapter.normalizeUrl({ sourceUrl: "https://www.douyin.com/video/7650000000000000000", dedupeKey }, context);
    expect((await adapter.resolveIdentity(normalized, context)).dedupeKey).toBe(dedupeKey);
  });

  it("recognizes note and article URLs in addition to video", () => {
    const adapter = new DouyinAdapter();
    expect(adapter.canHandle({ sourceUrl: "https://www.douyin.com/note/7650000000000000000" })).toBe(true);
    expect(adapter.canHandle({ sourceUrl: "https://www.douyin.com/article/7650000000000000000" })).toBe(true);
    expect(adapter.canHandle({ sourceUrl: "https://www.douyin.com/video/7650000000000000000" })).toBe(true);
  });

  it("normalizes note URL to a note canonical URL with the aweme id", async () => {
    const adapter = new DouyinAdapter();
    const normalized = await adapter.normalizeUrl({ sourceUrl: "https://www.douyin.com/note/7650000000000000000" }, context);
    const identity = await adapter.resolveIdentity(normalized, context);
    expect(identity).toMatchObject({ platform: "douyin", platformContentId: "7650000000000000000", canonicalUrl: "https://www.douyin.com/note/7650000000000000000", dedupeKey: "douyin:7650000000000000000" });
  });

  it("uses the verified existing missing-dedupe rule douyin:<work-id>", async () => {
    const adapter = new DouyinAdapter();
    const normalized = await adapter.normalizeUrl({ sourceUrl: "https://www.douyin.com/video/7650000000000000000" }, context);
    expect((await adapter.resolveIdentity(normalized, context)).dedupeKey).toBe("douyin:7650000000000000000");
  });

  it("wraps the existing capture dependency with equivalent browser and output options", async () => {
    const capture = vi.fn().mockResolvedValue({ sourceUrl: "https://source", resolvedUrl: "https://media.example/video", outputPath: "C:/synthetic/task/media/source.mp4", bytes: 12, hasAudio: true });
    const adapter = new DouyinAdapter({ captureMedia: capture, userDataDir: "C:/synthetic/.browser/douyin", headless: false, timeoutMs: 30000 });
    const normalized = await adapter.normalizeUrl({ sourceUrl: "https://www.douyin.com/video/7650000000000000000", dedupeKey: "douyin:7650000000000000000" }, context);
    const identity = await adapter.resolveIdentity(normalized, context);
    const source = await adapter.resolveContent(identity, context);
    const result = await adapter.materializeMedia(source, context);
    const outputPath = join(context.taskDir, "media", "source.mp4");
    expect(capture).toHaveBeenCalledWith({ inputUrl: identity.sourceUrl, outputPath, userDataDir: "C:/synthetic/.browser/douyin", headless: false, timeoutMs: 30000 }, expect.any(Function));
    expect(result[0]).toMatchObject({ kind: "video", localPath: outputPath, mediaUrl: "https://media.example/video", bytes: 12 });
  });
});
