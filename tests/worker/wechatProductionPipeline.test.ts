import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { PlatformAdapterError } from "../../src/platform/platformAdapter.js";
import { runWechatProductionPipeline, classifyWechatProductionError } from "../../src/worker/wechatProductionPipeline.js";
import type { NormalizedContent } from "../../src/platform/types.js";
import type { WechatAssetResult } from "../../src/platform/wechat/wechatAssetMaterializer.js";
import { buildWechatIdentity } from "../../src/platform/wechat/wechatUrl.js";

let taskDir: string;
const content: NormalizedContent = { identity: buildWechatIdentity("https://mp.weixin.qq.com/s/a"), contentType: "article", title: "文章", author: { name: "公众号" }, publishedAt: "2026-08-01", texts: [{ kind: "body", role: "primary", text: "这是完整且足够长的公众号原始正文，不需要任何语音识别。" }], media: [], links: [] };
beforeEach(async () => { taskDir = join(tmpdir(), `wx-pipeline-${randomUUID()}`); await mkdir(taskDir, { recursive: true }); });
afterEach(async () => { await rm(taskDir, { recursive: true, force: true }); });

function deps(resolveContent = vi.fn(async () => content)) {
  const materializeMedia = vi.fn(async () => []); const transcribe = vi.fn(async () => ({ text: "wrong", provider: "wrong" }));
  return { resolveContent, materializeMedia, transcribe, analyze: vi.fn(async () => ({ summary: "摘要", key_points: ["要点"], primary_category: "其他", secondary_category: "", useful_information: ["信息"], action_items: [], transcript_corrections: [], quality_warnings: [], source_record_id: "rec123456789", source_platform: "公众号", processor: "local-ai-analysis", model: "deepseek-chat", processor_version: "1.0.0" })), materializeImages: vi.fn(async (): Promise<WechatAssetResult> => ({ assets: [], warnings: [] })), persistImages: vi.fn(async (_content: NormalizedContent, result: WechatAssetResult) => result), writeNote: vi.fn(async () => ({ success: true, finalPath: "vault/公众号/文章.md", hash: "abc", conflict: "none" as const })), updateBase: vi.fn(async () => undefined), setStage: vi.fn(async (_stage: string, _index: number) => undefined) };
}

describe("WeChat production text-first pipeline", () => {
  it("completes through fake AI, Obsidian, Base and never invokes media/ASR", async () => {
    const d = deps(); const result = await runWechatProductionPipeline({ recordId: "rec123456789", taskDir, sourceUrl: content.identity.sourceUrl, declaredPlatform: "公众号", title: "文章", vaultPath: "vault" }, d);
    expect(result.preparationMode).toBe("text-first"); expect(d.materializeMedia).not.toHaveBeenCalled(); expect(d.transcribe).not.toHaveBeenCalled(); expect(d.analyze).toHaveBeenCalledOnce(); expect(d.writeNote).toHaveBeenCalledOnce(); expect(d.updateBase).toHaveBeenCalledWith(expect.objectContaining({ "处理状态": "done" }));
    expect(d.setStage.mock.calls.map(x => x[0])).toEqual(["claim", "resolve", "acquire", "prepare_content", "deepseek", "markdown", "obsidian", "base_done"]);
  });
  it("resumes from source cache without visiting WeChat again", async () => {
    const first = deps(); first.analyze.mockRejectedValueOnce(new Error("deepseek_timeout")); await expect(runWechatProductionPipeline({ recordId: "rec123456789", taskDir, sourceUrl: content.identity.sourceUrl, declaredPlatform: "公众号", title: "文章", vaultPath: "vault" }, first)).rejects.toThrow("deepseek_timeout");
    const second = deps(vi.fn(async () => { throw new Error("browser_must_not_run"); })); await runWechatProductionPipeline({ recordId: "rec123456789", taskDir, sourceUrl: content.identity.sourceUrl, declaredPlatform: "公众号", title: "文章", vaultPath: "vault" }, second);
    expect(second.resolveContent).not.toHaveBeenCalled();
  });
  it("stops before AI and persistence on a verification page", async () => {
    const d = deps(vi.fn(async () => { throw new PlatformAdapterError("verification_required"); }));
    await expect(runWechatProductionPipeline({ recordId: "rec123456789", taskDir, sourceUrl: content.identity.sourceUrl, declaredPlatform: "公众号", title: "文章", vaultPath: "vault" }, d)).rejects.toThrow("verification_required");
    expect(d.analyze).not.toHaveBeenCalled(); expect(d.writeNote).not.toHaveBeenCalled(); expect(d.updateBase).not.toHaveBeenCalled();
  });
  it("classifies verification as bounded non-retryable", () => { expect(classifyWechatProductionError(new PlatformAdapterError("verification_required"))).toEqual({ retryable: false, terminal: false }); });
  it("classifies deleted as terminal and network as retryable", () => { expect(classifyWechatProductionError(new PlatformAdapterError("article_deleted"))).toEqual({ retryable: false, terminal: true }); expect(classifyWechatProductionError(new PlatformAdapterError("temporary_network"))).toEqual({ retryable: true, terminal: false }); });
  it("passes image warnings through while still completing", async () => { const d = deps(); d.materializeImages.mockResolvedValue({ assets: [], warnings: ["image failed"] }); const result = await runWechatProductionPipeline({ recordId: "rec123456789", taskDir, sourceUrl: content.identity.sourceUrl, declaredPlatform: "公众号", title: "文章", vaultPath: "vault" }, d); expect(result.warnings).toEqual(["image failed"]); expect(d.updateBase).toHaveBeenCalled(); });
});
