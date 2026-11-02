export interface WechatPageBlock { tag: string; text: string }
export interface WechatPageImage { dataSrc?: string; src?: string; alt?: string; contextBefore?: string; contextAfter?: string; width?: number; height?: number }
export interface WechatPageSnapshot {
  url: string; title: string; account: string; publishedAt?: string; bodyText: string;
  blocks: WechatPageBlock[]; images: WechatPageImage[]; pageText: string;
  imageDiagnostics?: { dataSrc: number; httpSrc: number; dataUri: number; missing: number };
}
export interface ParsedWechatArticle {
  title: string; account: string; publishedAt?: string; body: string;
  images: Array<{ sourceUrl: string; order: number; alt?: string; context?: string; mimeType?: string }>;
}

