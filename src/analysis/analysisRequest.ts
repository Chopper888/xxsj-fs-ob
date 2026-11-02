import type { AnalysisInput } from "../platform/types.js";

export function buildDouyinAnalysisRequest(input: AnalysisInput, options: { sourcePlatform: string; sourceUrl?: string; model: string; segmentCount: number }) {
  return {
    source_record_id: input.sourceRecordId,
    title: input.title ?? "",
    source_platform: options.sourcePlatform,
    source_url: options.sourceUrl ?? input.canonicalUrl,
    whisper: { transcript: input.primaryText, segment_count: options.segmentCount },
    required_provenance: { source_record_id: input.sourceRecordId, source_platform: options.sourcePlatform, processor: "local-ai-analysis", model: options.model, processor_version: "1.0.0" },
  };
}

