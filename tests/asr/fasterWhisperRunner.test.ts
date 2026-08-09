import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("faster-whisper runner contract", () => {
  it("exposes explicit UTF-8 output, timestamps, VAD and non-overwrite controls", () => {
    const root = resolve(import.meta.dirname, "../..");
    const pythonExe = join(root, ".venv", "Scripts", "python.exe");
    if (!existsSync(pythonExe)) {
      return; // .venv not yet created (expected in isolated / new-user environments)
    }
    const result = spawnSync(pythonExe, [join(root, "scripts", "transcribe-faster-whisper.py"), "--help"], { encoding: "utf8" });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("--output");
    expect(result.stdout).toContain("--word-timestamps");
    expect(result.stdout).toContain("--vad-filter");
    expect(result.stdout).toContain("--initial-prompt");
    expect(result.stdout).toContain("--overwrite");
  });
});