export function formatReadableTranscript(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  const withCase = trimmed.replace(/\bskill\b/giu, "Skill");
  const compactTerms = withCase
    .replace(/(?<=\p{Script=Han})\s+(?=[A-Za-z])/gu, "")
    .replace(/(?<=[A-Za-z])\s+(?=\p{Script=Han})/gu, "");
  const punctuated = compactTerms.replace(/\s+/gu, "，").replace(/[，、；：]+$/u, "");
  return /[。！？!?]$/u.test(punctuated) ? punctuated : `${punctuated}。`;
}

export function formatReadableSegments(segments: string[]): string {
  return segments.map((segment) => formatReadableTranscript(segment).replace(/,/g, "，")).filter(Boolean).join("\n\n");
}

export function formatReadableSegmentGroups(segments: string[], groups: number[][]): string {
  const sentences = groups.map((indices) => indices.map((index) => segments[index]?.trim() ?? "").filter(Boolean).join("，"));
  return formatReadableSegments(sentences).replace(/，{2,}/g, "，").replace(/,，/g, "，");
}
