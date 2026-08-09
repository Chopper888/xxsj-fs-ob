export const APPROVED_ASR_RECORD_ID = "recvr510Ek3WgD";

export function assertComparisonScope(recordId: string): void {
  if (recordId !== APPROVED_ASR_RECORD_ID) throw new Error("asr_comparison_scope_refused");
}

export function artifactNames(localModel: string, qwenModel: string) {
  return {
    whisperBaseOriginal: "whisper-base-original.json",
    whisperBaseReadable: "whisper-base-readable.md",
    localOriginal: `faster-whisper-${localModel}-original.json`,
    localReadable: `faster-whisper-${localModel}-readable.md`,
    qwenOriginal: "qwen-asr-original.sanitized.json",
    qwenReadable: "qwen-asr-readable.md",
    comparison: "comparison.json", report: "comparison-report.md", groundTruth: "ground-truth.md",
    baseWrites: false as const, obsidianWrites: false as const,
  };
}

export interface RankableResult { provider: string; status: "completed" | "blocked" | "failed"; normalizedCer: number; real: boolean }
export function rankCompletedResults(results: RankableResult[]): RankableResult[] {
  return results.filter((result) => result.status === "completed" && result.real).sort((a, b) => a.normalizedCer - b.normalizedCer);
}

export async function readTextArtifacts(directory: string): Promise<string[]> {
  const { readdir, readFile } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const files = (await readdir(directory)).filter((file) => /\.(json|md|log)$/i.test(file)).sort();
  return Promise.all(files.map((file) => readFile(join(directory, file), "utf8")));
}
