import { describe, expect, it } from "vitest";
import { buildSentenceDiffs, calculateCer, normalizeForCer } from "../../src/asr/evaluation.js";
import { formatReadableSegmentGroups, formatReadableSegments, formatReadableTranscript } from "../../src/asr/readable.js";

describe("ASR evaluation", () => {
  it("reports substitutions, insertions and deletions with strict CER", () => {
    const result = calculateCer("skill，知识。", "Skill知识图");
    expect(result).toMatchObject({ referenceCharacters: 9, substitutions: 2, insertions: 0, deletions: 1, distance: 3 });
    expect(result.cer).toBeCloseTo(1 / 3);
  });

  it("normalizes punctuation whitespace and English case for content CER", () => {
    expect(normalizeForCer(" Skill，知识 图。", "content_normalized")).toBe("skill知识图");
    expect(normalizeForCer(" Skill，知识 图。", "strict")).toBe(" Skill，知识 图。");
  });

  it("produces human-readable sentence differences", () => {
    const diffs = buildSentenceDiffs("第一句。第二句！", "第一句。第二段！");
    expect(diffs).toEqual([
      { index: 1, reference: "第一句。", hypothesis: "第一句。", match: true },
      { index: 2, reference: "第二句！", hypothesis: "第二段！", match: false },
    ]);
  });

  it("only adds punctuation and casing without replacing source words", () => {
    const raw = "很多视频收藏了 却再也没时间细看 skill帮你";
    const readable = formatReadableTranscript(raw);
    expect(readable).toBe("很多视频收藏了，却再也没时间细看Skill帮你。");
    expect(normalizeForCer(readable, "content_normalized")).toBe(normalizeForCer(raw, "content_normalized"));
    expect(raw).toBe("很多视频收藏了 却再也没时间细看 skill帮你");
  });

  it("removes display spaces around an English term embedded in Chinese instead of adding commas", () => {
    expect(formatReadableTranscript("我这个 skill 帮你")).toBe("我这个Skill帮你。");
  });

  it("uses ASR segment boundaries without changing segment words", () => {
    expect(formatReadableSegments(["很多视频收藏了,却再没时间", "skill帮你"])).toBe("很多视频收藏了，却再没时间。\n\nSkill帮你。");
  });

  it("groups adjacent segments for aligned sentence review without changing words", () => {
    expect(formatReadableSegmentGroups(["第一半", "第二半", "下一句"], [[0, 1], [2]])).toBe("第一半，第二半。\n\n下一句。");
  });
});
