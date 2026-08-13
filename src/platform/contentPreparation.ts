import type { AnalysisInput, MaterializedMedia, NormalizedContent, PreparedContent, PreparedTextPart } from "./types.js";

export interface ContentPreparationDependencies {
  materializeMedia(content: NormalizedContent): Promise<MaterializedMedia[]>;
  transcribe(media: MaterializedMedia[]): Promise<{ text: string; provider: string; segments?: unknown[] }>;
}

export async function prepareContent(source: NormalizedContent, deps: ContentPreparationDependencies): Promise<PreparedContent> {
  const subtitle = source.texts.find((part) => part.kind === "official_subtitle" && part.text.trim());
  const native = source.texts.find((part) => part.role === "primary" && part.kind !== "official_subtitle" && part.text.trim());
  if (subtitle || native) {
    const primary = subtitle ?? native!;
    const mode = subtitle ? "subtitle-first" : "text-first";
    const texts: PreparedTextPart[] = source.texts.filter((part) => part.text.trim()).map((part) => ({
      origin: part.kind === "official_subtitle" ? "official_subtitle" : "native",
      role: part === primary ? "primary" : "context", text: part.text,
    }));
    return { source, texts, primaryText: primary.text, preparationMode: mode };
  }
  if (!source.media.some((media) => media.kind === "audio" || media.kind === "video")) throw new Error("content_empty");
  const materialized = await deps.materializeMedia(source);
  const transcript = await deps.transcribe(materialized);
  return { source, texts: [{ origin: "asr", role: "primary", text: transcript.text, provider: transcript.provider }], primaryText: transcript.text, transcript, preparationMode: "media-first" };
}

export function toAnalysisInput(sourceRecordId: string, prepared: PreparedContent): AnalysisInput {
  const { source } = prepared;
  return {
    sourceRecordId, platform: source.identity.platform, canonicalUrl: source.identity.canonicalUrl,
    title: source.title, author: source.author?.name, publishedAt: source.publishedAt,
    primaryText: prepared.primaryText,
    contextTexts: source.texts.filter((part) => part.text !== prepared.primaryText).map((part) => ({ kind: part.kind, text: part.text })),
    provenance: { platformContentId: source.identity.platformContentId, dedupeKey: source.identity.dedupeKey },
  };
}
