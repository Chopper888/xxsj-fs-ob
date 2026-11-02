export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export type PlatformId = "douyin" | "wechat_official_account" | "bilibili" | "x" | "youtube";
export type PlatformContentType = "video" | "article" | "post" | "thread" | "mixed";

export interface PlatformIdentity {
  platform: PlatformId;
  platformContentId: string;
  sourceUrl: string;
  canonicalUrl: string;
  dedupeKey: string;
  dedupeAliases?: string[];
}

export interface NormalizedTextPart {
  kind: "body" | "caption" | "official_subtitle" | "thread_item" | "quoted_post";
  role: "primary" | "context";
  text: string;
  language?: string;
}

export interface NormalizedMedia {
  kind: "audio" | "video" | "image";
  role: "primary" | "context";
  sourceUrl?: string;
  order?: number;
  alt?: string;
  caption?: string;
  context?: string;
  mimeType?: string;
}

export interface NormalizedLink { url: string; role: "source" | "context" | "external"; title?: string }

export interface NormalizedContent {
  identity: PlatformIdentity;
  contentType: PlatformContentType;
  title?: string;
  author?: { id?: string; name: string; url?: string };
  publishedAt?: string;
  texts: NormalizedTextPart[];
  media: NormalizedMedia[];
  links: NormalizedLink[];
  sourceMetadata?: Record<string, JsonValue>;
}

export interface MaterializedMedia {
  kind: "audio" | "video";
  localPath: string;
  mediaUrl?: string;
  bytes?: number;
}

export interface PreparedTextPart {
  origin: "native" | "official_subtitle" | "asr";
  role: "primary" | "context";
  text: string;
  provider?: string;
}

export interface PreparedContent {
  source: NormalizedContent;
  texts: PreparedTextPart[];
  primaryText: string;
  transcript?: { text: string; provider: string; segments?: unknown[] };
  preparationMode: "text-first" | "subtitle-first" | "media-first";
}

export interface AnalysisInput {
  sourceRecordId: string;
  platform: PlatformId;
  canonicalUrl: string;
  title?: string;
  author?: string;
  publishedAt?: string;
  primaryText: string;
  contextTexts: Array<{ kind: string; text: string }>;
  provenance: { platformContentId: string; dedupeKey: string };
}
