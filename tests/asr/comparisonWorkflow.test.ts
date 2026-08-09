import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { artifactNames, assertComparisonScope, rankCompletedResults, readTextArtifacts } from "../../src/asr/comparisonWorkflow.js";

describe("ASR comparison workflow boundaries", () => {
  it("accepts only the approved record", () => {
    expect(() => assertComparisonScope("other")).toThrow("asr_comparison_scope_refused");
    expect(assertComparisonScope("recvr510Ek3WgD")).toBeUndefined();
  });

  it("uses distinct model-specific artifact names", () => {
    const names = artifactNames("large-v3", "qwen3-asr-flash-filetrans");
    const files = Object.values(names).filter((value): value is string => typeof value === "string");
    expect(new Set(files).size).toBe(files.length);
    expect(names.whisperBaseOriginal).toBe("whisper-base-original.json");
    expect(names.localOriginal).toBe("faster-whisper-large-v3-original.json");
    expect(names.qwenOriginal).toBe("qwen-asr-original.sanitized.json");
    expect(names.qwenReadable).toBe("qwen-asr-readable.md");
  });

  it("excludes blocked and mock results from quality ranking", () => {
    const ranked = rankCompletedResults([
      { provider: "base", status: "completed", normalizedCer: 0.2, real: true },
      { provider: "qwen", status: "blocked", normalizedCer: 0, real: false },
      { provider: "mock", status: "completed", normalizedCer: 0, real: false },
    ]);
    expect(ranked.map((item) => item.provider)).toEqual(["base"]);
  });

  it("declares no Base or Obsidian side effects", () => {
    expect(artifactNames("large-v3", "qwen3-asr-flash-filetrans")).toMatchObject({
      baseWrites: false, obsidianWrites: false,
    });
  });

  it("reads text artifacts as strings instead of passing a Promise to Promise.all", async () => {
    const directory = await mkdtemp(join(tmpdir(), "asr-artifacts-"));
    await writeFile(join(directory, "one.json"), "{\"ok\":true}", "utf8");
    await writeFile(join(directory, "ignored.bin"), "binary", "utf8");
    expect(await readTextArtifacts(directory)).toEqual(["{\"ok\":true}"]);
  });
});
