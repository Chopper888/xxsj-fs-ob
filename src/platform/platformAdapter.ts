import type { MaterializedMedia, NormalizedContent, PlatformId, PlatformIdentity } from "./types.js";

export interface PlatformInput { sourceUrl: string; declaredPlatform?: string; dedupeKey?: string }
export interface NormalizedUrl { sourceUrl: string; canonicalUrl: string; dedupeKey?: string; platformContentId?: string }
export interface SafeLogger { info(message: string): void; warn(message: string): void }
export interface PlatformRuntimeContext { taskDir: string; signal: AbortSignal; logger: SafeLogger }

export type PlatformAdapterErrorCode = "invalid_url" | "not_found" | "private_content" | "auth_required" | "rate_limited" | "temporary_network" | "content_unavailable" | "media_unavailable";
export class PlatformAdapterError extends Error {
  constructor(public readonly code: PlatformAdapterErrorCode, message: string = code) { super(message); this.name = "PlatformAdapterError"; }
}

export interface PlatformAdapter {
  readonly platform: PlatformId;
  canHandle(input: PlatformInput): boolean;
  normalizeUrl(input: PlatformInput, context: PlatformRuntimeContext): Promise<NormalizedUrl>;
  resolveIdentity(normalized: NormalizedUrl, context: PlatformRuntimeContext): Promise<PlatformIdentity>;
  resolveContent(identity: PlatformIdentity, context: PlatformRuntimeContext): Promise<NormalizedContent>;
  materializeMedia?(content: NormalizedContent, context: PlatformRuntimeContext): Promise<MaterializedMedia[]>;
}
