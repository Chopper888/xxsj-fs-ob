import { afterEach, describe, expect, it, vi } from "vitest";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { createProductionAdapterRegistry } from "../../src/platform/productionRegistry.js";
import { runWechatProductionPipeline } from "../../src/worker/wechatProductionPipeline.js";
import { prepareAttemptFields, selectRunnableRecordIds } from "../../src/worker/workerLifecycle.js";
import type { WechatAssetResult } from "../../src/platform/wechat/wechatAssetMaterializer.js";

const loadFixture = async (name: string) => JSON.parse(await readFile(new URL(`../fixtures/wechat/${name}.json`, import.meta.url), "utf8"));
const taskDirs: string[] = [];
afterEach(async () => { await Promise.all(taskDirs.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });

describe("production WeChat intake compatibility", () => {
  it("takes the real intake shape from queue selection through fake Base done without ASR", async () => {
    const record = await loadFixture("production-intake-record");
    expect(selectRunnableRecordIds([record], 1)).toEqual([record.record_id]);
    expect(prepareAttemptFields(record.fields)).toMatchObject({ "处理状态": "processing" });

    const snapshot = await loadFixture("normal-article");
    const registry = createProductionAdapterRegistry({ projectRoot: process.cwd(), wechatCapture: vi.fn(async () => snapshot) });
    const input = { sourceUrl: record.fields["原文链接"], declaredPlatform: record.fields["来源平台"], dedupeKey: record.fields["去重ID"] };
    const adapter = registry.resolve(input);
    expect(adapter.platform).toBe("wechat_official_account");
    const context = { taskDir: "unused", signal: new AbortController().signal, logger: { info: vi.fn(), warn: vi.fn() } };
    const normalized = await adapter.normalizeUrl(input, context);
    const identity = await adapter.resolveIdentity(normalized, context);
    const content = await adapter.resolveContent(identity, context);
    expect(content.identity.dedupeKey).toBe("weixin:example-article-id");
    expect(content.identity.dedupeAliases).toEqual(expect.arrayContaining([expect.stringMatching(/^wechat:/)]));

    const taskDir = join(tmpdir(), `wechat-intake-${randomUUID()}`); taskDirs.push(taskDir);
    const materializeMedia = vi.fn(); const transcribe = vi.fn(); const updateBase = vi.fn(async () => undefined);
    const result = await runWechatProductionPipeline({ recordId: record.record_id, taskDir, sourceUrl: input.sourceUrl, declaredPlatform: input.declaredPlatform, title: record.fields["标题"], vaultPath: "fake-vault" }, {
      resolveContent: vi.fn(async () => content), materializeMedia, transcribe,
      analyze: vi.fn(async () => ({ summary: "摘要", key_points: ["要点"], primary_category: "其他", secondary_category: "", useful_information: [], action_items: [], transcript_corrections: [], quality_warnings: [], source_record_id: record.record_id, source_platform: "公众号", processor: "local-ai-analysis", model: "deepseek-chat", processor_version: "1.0.0" })),
      materializeImages: vi.fn(async (): Promise<WechatAssetResult> => ({ assets: [], warnings: [] })),
      persistImages: vi.fn(async (_content, assets) => assets),
      writeNote: vi.fn(async () => ({ success: true, finalPath: "fake-vault/公众号/真实入口兼容文章.md", hash: "hash", conflict: "none" as const })),
      updateBase, setStage: vi.fn(async () => undefined),
    });
    expect(result.preparationMode).toBe("text-first");
    expect(materializeMedia).not.toHaveBeenCalled(); expect(transcribe).not.toHaveBeenCalled();
    expect(updateBase).toHaveBeenCalledWith(expect.objectContaining({ "处理状态": "done" }));
    expect(record.fields["去重ID"]).toBe("weixin:example-article-id");
  });
});
