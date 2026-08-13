import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { materializeWechatImages, persistWechatAssetsToVault } from "../../src/platform/wechat/wechatAssetMaterializer.js";

let dir: string;
beforeEach(async () => { dir = join(tmpdir(), `wx-assets-${randomUUID()}`); await mkdir(dir, { recursive: true }); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

describe("WeChat image materialization", () => {
  it("reuses a complete task-local manifest without network downloads", async () => {
    const assetDir = join(dir, "assets"); await mkdir(assetDir, { recursive: true });
    const localPath = join(assetDir, "001-existing.png"); await writeFile(localPath, new Uint8Array([1, 2, 3]));
    const sourceUrl = "https://mmbiz.qpic.cn/example/reuse";
    await writeFile(join(assetDir, "manifest.json"), JSON.stringify({ version: 1, articleUrl: "https://mp.weixin.qq.com/s/a", assets: [{ sourceUrl, localPath, markdownPath: "assets/001-existing.png", order: 1, contentType: "image/png", bytes: 3 }], warnings: [] }));
    const fetchImpl = vi.fn();
    const result = await materializeWechatImages([{ kind: "image", role: "context", sourceUrl, order: 1 }], { taskDir: dir, articleUrl: "https://mp.weixin.qq.com/s/a", fetchImpl: fetchImpl as typeof fetch });
    expect(fetchImpl).not.toHaveBeenCalled(); expect(result.assets).toHaveLength(1); expect(result.assets[0].localPath).toBe(localPath);
  });
  it("uses referer, deterministic names, and writes a manifest", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(new Headers(init?.headers).get("referer")).toBe("https://mp.weixin.qq.com/s/a");
      return new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/jpeg" } });
    });
    const result = await materializeWechatImages([{ kind: "image", role: "context", sourceUrl: "https://mmbiz.qpic.cn/a?wx_fmt=jpeg", order: 1 }], { taskDir: dir, articleUrl: "https://mp.weixin.qq.com/s/a", fetchImpl });
    expect(result.assets[0].localPath).toMatch(/assets[\\/]001-[a-f0-9]{12}\.jpg$/);
    expect(JSON.parse(await readFile(join(dir, "assets", "manifest.json"), "utf8")).assets).toHaveLength(1);
  });
  it("rejects HTML and records a warning without failing the article", async () => {
    const result = await materializeWechatImages([{ kind: "image", role: "context", sourceUrl: "https://mmbiz.qpic.cn/b", order: 2 }], { taskDir: dir, articleUrl: "https://mp.weixin.qq.com/s/a", retries: 0, fetchImpl: async () => new Response("<html>error</html>", { headers: { "content-type": "text/html" } }) });
    expect(result.assets).toEqual([]); expect(result.warnings[0]).toContain("image_content_type_invalid");
  });
  it("retries a finite number of times", async () => {
    const fetchImpl = vi.fn(async () => new Response("bad", { status: 503 }));
    await materializeWechatImages([{ kind: "image", role: "context", sourceUrl: "https://mmbiz.qpic.cn/c", order: 1 }], { taskDir: dir, articleUrl: "https://mp.weixin.qq.com/s/a", retries: 2, fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });
  it("copies task assets into a deterministic vault-relative directory", async () => {
    const downloaded = await materializeWechatImages([{ kind: "image", role: "context", sourceUrl: "https://mmbiz.qpic.cn/d", order: 1 }], { taskDir: dir, articleUrl: "https://mp.weixin.qq.com/s/a", fetchImpl: async () => new Response(new Uint8Array([1]), { headers: { "content-type": "image/png" } }) });
    const persisted = await persistWechatAssetsToVault(downloaded, { vaultPath: join(dir, "vault"), targetDir: "公众号", dedupeKey: "wechat:abc" });
    expect(persisted.assets[0].markdownPath).toMatch(/^_assets\/[a-f0-9]{16}\//); expect(await readFile(persisted.assets[0].localPath)).toEqual(Buffer.from([1]));
  });
});
