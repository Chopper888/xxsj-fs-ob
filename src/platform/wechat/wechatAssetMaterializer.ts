import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import type { NormalizedMedia } from "../types.js";

type FetchLike = typeof fetch;
export interface WechatLocalAsset { sourceUrl: string; localPath: string; markdownPath: string; order: number; contentType: string; bytes: number; alt?: string }
export interface WechatAssetResult { assets: WechatLocalAsset[]; warnings: string[] }
export interface WechatAssetOptions { taskDir: string; articleUrl: string; fetchImpl?: FetchLike; retries?: number }
export interface WechatVaultAssetOptions { vaultPath: string; targetDir: string; dedupeKey: string }
const UA = "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36 MicroMessenger/8.0.49";
const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/gif": "gif", "image/webp": "webp", "image/svg+xml": "svg" };

export async function materializeWechatImages(media: NormalizedMedia[], options: WechatAssetOptions): Promise<WechatAssetResult> {
  const fetchImpl = options.fetchImpl ?? fetch; const retries = Math.max(0, Math.min(options.retries ?? 2, 4));
  const dir = join(options.taskDir, "assets"); await mkdir(dir, { recursive: true });
  const requested = media.filter(x => x.kind === "image" && x.sourceUrl).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  try {
    const cached = JSON.parse(await readFile(join(dir, "manifest.json"), "utf8")) as { version?: number; articleUrl?: string; assets?: WechatLocalAsset[]; warnings?: string[] };
    const bySource = new Map((cached.assets ?? []).map(asset => [asset.sourceUrl, asset]));
    const reusable = requested.map(item => bySource.get(item.sourceUrl!));
    if (cached.version === 1 && cached.articleUrl === options.articleUrl && reusable.every(Boolean)) {
      await Promise.all(reusable.map(async asset => { const file = await stat(asset!.localPath); if (!file.isFile() || file.size !== asset!.bytes) throw new Error("asset_cache_invalid"); }));
      return { assets: reusable as WechatLocalAsset[], warnings: cached.warnings ?? [] };
    }
  } catch {}
  const assets: WechatLocalAsset[] = []; const warnings: string[] = [];
  for (const item of requested) {
    const sourceUrl = item.sourceUrl!; let lastError = "image_download_failed";
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const response = await fetchImpl(sourceUrl, { headers: { "User-Agent": UA, Referer: options.articleUrl, Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8" }, signal: AbortSignal.timeout(15_000) });
        if (!response.ok) throw new Error(`image_http_${response.status}`);
        const contentType = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
        if (!contentType.startsWith("image/") || !EXT[contentType]) throw new Error(`image_content_type_invalid:${contentType || "missing"}`);
        const bytes = new Uint8Array(await response.arrayBuffer()); if (!bytes.length) throw new Error("image_empty");
        const order = item.order ?? assets.length + 1; const digest = createHash("sha256").update(sourceUrl).digest("hex").slice(0, 12);
        const filename = `${String(order).padStart(3, "0")}-${digest}.${EXT[contentType]}`; const localPath = join(dir, filename);
        await writeFile(localPath, bytes); assets.push({ sourceUrl, localPath, markdownPath: `assets/${filename}`, order, contentType, bytes: bytes.length, alt: item.alt }); lastError = ""; break;
      } catch (error) { lastError = error instanceof Error ? error.message : String(error); }
    }
    if (lastError) warnings.push(`${lastError}:${createHash("sha256").update(sourceUrl).digest("hex").slice(0, 12)}`);
  }
  await writeFile(join(dir, "manifest.json"), JSON.stringify({ version: 1, articleUrl: options.articleUrl, assets, warnings }, null, 2) + "\n", "utf8");
  return { assets, warnings };
}

export async function persistWechatAssetsToVault(result: WechatAssetResult, options: WechatVaultAssetOptions): Promise<WechatAssetResult> {
  const articleDir = createHash("sha256").update(options.dedupeKey).digest("hex").slice(0, 16);
  const relativeDir = `_assets/${articleDir}`; const target = join(options.vaultPath, options.targetDir, "_assets", articleDir);
  await mkdir(target, { recursive: true });
  const assets: WechatLocalAsset[] = [];
  for (const asset of result.assets) {
    const filename = basename(asset.localPath); const localPath = join(target, filename); await copyFile(asset.localPath, localPath);
    assets.push({ ...asset, localPath, markdownPath: `${relativeDir}/${filename}` });
  }
  return { assets, warnings: result.warnings };
}
