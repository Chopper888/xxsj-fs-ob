export type CerMode = "strict" | "content_normalized";

export interface CerResult {
  mode: CerMode;
  referenceCharacters: number;
  hypothesisCharacters: number;
  substitutions: number;
  insertions: number;
  deletions: number;
  distance: number;
  cer: number;
}

export function normalizeForCer(text: string, mode: CerMode): string {
  if (mode === "strict") return text;
  return text.toLocaleLowerCase("en-US").replace(/[\s\p{P}\p{S}]/gu, "");
}

export function calculateCer(reference: string, hypothesis: string, mode: CerMode = "strict"): CerResult {
  const ref = [...normalizeForCer(reference, mode)];
  const hyp = [...normalizeForCer(hypothesis, mode)];
  type Cell = { distance: number; substitutions: number; insertions: number; deletions: number };
  const matrix: Cell[][] = Array.from({ length: ref.length + 1 }, () => Array<Cell>(hyp.length + 1));
  matrix[0][0] = { distance: 0, substitutions: 0, insertions: 0, deletions: 0 };
  for (let i = 1; i <= ref.length; i++) matrix[i][0] = { distance: i, substitutions: 0, insertions: 0, deletions: i };
  for (let j = 1; j <= hyp.length; j++) matrix[0][j] = { distance: j, substitutions: 0, insertions: j, deletions: 0 };
  for (let i = 1; i <= ref.length; i++) {
    for (let j = 1; j <= hyp.length; j++) {
      if (ref[i - 1] === hyp[j - 1]) matrix[i][j] = { ...matrix[i - 1][j - 1] };
      else {
        const candidates: Cell[] = [
          { ...matrix[i - 1][j - 1], distance: matrix[i - 1][j - 1].distance + 1, substitutions: matrix[i - 1][j - 1].substitutions + 1 },
          { ...matrix[i][j - 1], distance: matrix[i][j - 1].distance + 1, insertions: matrix[i][j - 1].insertions + 1 },
          { ...matrix[i - 1][j], distance: matrix[i - 1][j].distance + 1, deletions: matrix[i - 1][j].deletions + 1 },
        ];
        matrix[i][j] = candidates.sort((a, b) => a.distance - b.distance || a.insertions - b.insertions || a.deletions - b.deletions)[0];
      }
    }
  }
  const final = matrix[ref.length][hyp.length];
  return { mode, referenceCharacters: ref.length, hypothesisCharacters: hyp.length, ...final, cer: ref.length ? final.distance / ref.length : hyp.length ? 1 : 0 };
}

function sentences(text: string): string[] {
  return text.match(/[^。！？!?]+[。！？!?]?/gu)?.map((value) => value.trim()).filter(Boolean) ?? [];
}

export function buildSentenceDiffs(reference: string, hypothesis: string) {
  const refs = sentences(reference), hyps = sentences(hypothesis);
  return Array.from({ length: Math.max(refs.length, hyps.length) }, (_, index) => ({
    index: index + 1, reference: refs[index] ?? "", hypothesis: hyps[index] ?? "", match: refs[index] === hyps[index],
  }));
}
