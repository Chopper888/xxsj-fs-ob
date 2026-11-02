import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import type { NormalizedContent, PlatformIdentity } from "./types.js";

const CACHE_VERSION = 1;
export function normalizedContentCachePath(taskDir: string): string { return join(taskDir, "source", "normalized-content.json"); }

function valid(value: unknown, expected: PlatformIdentity): value is NormalizedContent {
  if (!value || typeof value !== "object") return false;
  const content = value as NormalizedContent;
  const analyzableArticle = content.contentType === "article" && content.texts?.some(part => part.role === "primary" && part.text.trim().length >= 20);
  const validVideo = content.contentType === "video" && Boolean(content.title?.trim()) && content.media?.some(media => media.kind === "video");
  const validPost = content.contentType === "post" && content.texts?.some(part => part.role === "primary" && part.text.trim().length > 0);
  return (analyzableArticle || validVideo || validPost)
    && content.identity?.platform === expected.platform
    && (!expected.dedupeKey || content.identity?.dedupeKey === expected.dedupeKey || Boolean(content.identity?.dedupeAliases?.includes(expected.dedupeKey)))
    && content.identity?.canonicalUrl === expected.canonicalUrl;
}

export async function loadNormalizedContentCache(taskDir: string, expected: PlatformIdentity): Promise<NormalizedContent | null> {
  try {
    const envelope = JSON.parse(await readFile(normalizedContentCachePath(taskDir), "utf8")) as { schemaVersion?: number; sourceFingerprint?: string; normalizedContent?: unknown };
    if (envelope.schemaVersion !== CACHE_VERSION || !valid(envelope.normalizedContent, expected)) return null;
    return envelope.sourceFingerprint === fingerprint(envelope.normalizedContent) ? envelope.normalizedContent : null;
  } catch { return null; }
}

export async function saveNormalizedContentCache(taskDir: string, content: NormalizedContent): Promise<void> {
  const dir = join(taskDir, "source"); await mkdir(dir, { recursive: true });
  const target = normalizedContentCachePath(taskDir); const temp = `${target}.tmp-${process.pid}-${Date.now()}`;
  const cacheSafeContent: NormalizedContent = { ...content, identity: { ...content.identity, sourceUrl: content.identity.canonicalUrl } };
  await writeFile(temp, JSON.stringify({ schemaVersion: CACHE_VERSION, capturedAt: new Date().toISOString(), sourceFingerprint: fingerprint(cacheSafeContent), normalizedContent: cacheSafeContent }, null, 2) + "\n", "utf8");
  await rename(temp, target);
}

function fingerprint(content: NormalizedContent): string {
  const primary = content.texts.find(part => part.role === "primary")?.text ?? "";
  return createHash("sha256").update(`${content.identity.dedupeKey}\n${content.contentType}\n${content.title ?? ""}\n${primary}`, "utf8").digest("hex");
}
