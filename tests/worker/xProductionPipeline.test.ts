import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { runXProductionPipeline } from "../../src/worker/xProductionPipeline.js";
import { buildXIdentity } from "../../src/platform/x/xUrl.js";
import type { NormalizedContent } from "../../src/platform/types.js";
import type { WechatAssetResult, WechatLocalAsset } from "../../src/platform/wechat/wechatAssetMaterializer.js";

let taskDir: string;
beforeEach(async () => { taskDir = join(tmpdir(), `x-pipeline-${randomUUID()}`); await mkdir(taskDir, { recursive: true }); });
afterEach(async () => rm(taskDir, { recursive: true, force: true }));

const content: NormalizedContent = { identity: buildXIdentity("https://x.com/alice/status/123"), contentType: "post", author: { name: "Alice", id: "alice" }, publishedAt: "2026-08-14", texts: [{ kind: "body", role: "primary", text: "一条有实际分析价值的公开 Post 正文。" }], media: [], links: [], sourceMetadata: { handle: "alice", mediaHint: true, resolvedEmbedPostId: "999", embedResolvedDifferentPost: true } };
const analysis = { summary: "摘要", key_points: ["要点"], primary_category: "其他", secondary_category: "", useful_information: ["信息"], action_items: [], transcript_corrections: [], quality_warnings: [], source_record_id: "rec123456789", source_platform: "推特", processor: "local-ai-analysis", model: "deepseek-chat", processor_version: "1.0.0" };

function deps(resolveContent = vi.fn(async () => content)) {
  return {
    resolveContent,
    materializeMedia: vi.fn(),
    transcribe: vi.fn(),
    materializeImages: vi.fn(async (): Promise<WechatAssetResult> => ({ assets: [], warnings: [] })),
    persistImages: vi.fn(async (_content: NormalizedContent, result: WechatAssetResult): Promise<WechatAssetResult> => result),
    analyze: vi.fn(async () => analysis),
    writeNote: vi.fn(async (note: { targetDir: string; title: string; workId: string; content: string; vaultPath: string; recordId: string }) => ({ success: true, finalPath: "vault/推特/post.md", hash: "h", conflict: "none" as const })),
    updateBase: vi.fn(async (_f: Record<string, unknown>) => {}),
    setStage: vi.fn(async (_s: string, _i: number) => {}),
  };
}
const input = () => ({ recordId: "rec123456789", taskDir, sourceUrl: "https://x.com/alice/status/123", declaredPlatform: "推特", title: "Post", vaultPath: "vault" });

describe("X production pipeline", () => {
  it("正文 Post 完成 text-first、fake Obsidian/Base done 且 ASR=0", async () => {
    const d = deps();
    const r = await runXProductionPipeline(input(), d);
    expect(r.preparationMode).toBe("text-first");
    expect(d.materializeMedia).not.toHaveBeenCalled();
    expect(d.transcribe).not.toHaveBeenCalled();
    expect(d.writeNote).toHaveBeenCalledOnce();
    expect(d.updateBase).toHaveBeenCalledWith(expect.objectContaining({ "处理状态": "done" }));
  });
  it("AI 失败后 source cache 恢复不再请求 oEmbed", async () => {
    const a = deps(); a.analyze.mockRejectedValueOnce(new Error("ai_fail"));
    await expect(runXProductionPipeline(input(), a)).rejects.toThrow("ai_fail");
    const b = deps(vi.fn(async () => { throw new Error("oembed_must_not_run"); }));
    await runXProductionPipeline(input(), b);
    expect(b.resolveContent).not.toHaveBeenCalled();
  });
  it("保持输入 repost identity，不使用 resolved 原帖 ID 命名", async () => {
    const d = deps();
    await runXProductionPipeline(input(), d);
    expect(d.writeNote).toHaveBeenCalledWith(expect.objectContaining({ workId: "123" }));
  });
  it("下载图片经 materialize/persist 后写入 markdown 本地引用与溯源", async () => {
    const d = deps();
    const localAsset: WechatLocalAsset = { sourceUrl: "https://pbs.twimg.com/media/abc.jpg", localPath: join(taskDir, "assets", "001-abc.jpg"), markdownPath: "_assets/hash16/001-abc.jpg", order: 1, contentType: "image/jpeg", bytes: 100 };
    d.materializeImages.mockResolvedValue({ assets: [localAsset], warnings: [] });
    d.persistImages.mockResolvedValue({ assets: [localAsset], warnings: [] });
    await runXProductionPipeline(input(), d);
    const note = d.writeNote.mock.calls[0][0];
    expect(note.content).toContain("## 原文图片");
    expect(note.content).toContain("](_assets/hash16/001-abc.jpg)");
    expect(note.content).toContain("原始图片链接：https://pbs.twimg.com/media/abc.jpg");
    expect(note.content).toContain("image_source_urls");
  });
  it("图片全部下载失败时回退到 mediaHint 提示且不写图片区", async () => {
    const d = deps();
    d.materializeImages.mockResolvedValue({ assets: [], warnings: ["image_magic_invalid:image/png:deadbeef"] });
    await runXProductionPipeline(input(), d);
    const note = d.writeNote.mock.calls[0][0];
    expect(note.content).not.toContain("## 原文图片");
    expect(note.content).toContain("## 采集警告");
    expect(note.content).toContain("请查看原始链接");
  });
});
