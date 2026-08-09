import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildNoteFilename, sanitizeNoteFilename, sha256, writeMarkdownAtomically, verifyWrittenNote } from "../../src/obsidian/noteWriter.js";

describe("sanitizeNoteFilename", () => {
  it("replaces illegal Windows characters", () => { expect(sanitizeNoteFilename("a<b:c>d?e*f")).toBe("a-b-c-d-e-f"); });
  it("collapses multiple spaces", () => { expect(sanitizeNoteFilename("a   b")).toBe("a b"); });
  it("trims trailing spaces and dots", () => { expect(sanitizeNoteFilename("abc... ")).toBe("abc"); });
  it("truncates long filenames with hash suffix", () => {
    const long = "A".repeat(200);
    const result = sanitizeNoteFilename(long);
    expect(result.length).toBeLessThanOrEqual(190);
    expect(result).toMatch(/-[a-f0-9]{7}$/);
  });
  it("returns fallback for empty input", () => { expect(sanitizeNoteFilename("")).toBe("untitled-note"); });
});

describe("buildNoteFilename", () => {
  it("title scheme", () => { expect(buildNoteFilename("Test Note", "dy_765", "", "title")).toBe("Test Note.md"); });
  it("date-title scheme with date", () => { expect(buildNoteFilename("Test", "dy_001", "2026-07-26", "date-title")).toBe("2026-07-26 - Test.md"); });
  it("date-title scheme without date", () => { expect(buildNoteFilename("Test", "dy_001", "", "date-title")).toBe("nodate - Test.md"); });
  it("title-workid scheme", () => { const r = buildNoteFilename("Test Note", "douyin:7663214772837436715", "", "title-workid"); expect(r).toContain("Test Note"); expect(r).toContain(".md"); expect(r.length).toBeGreaterThan("Test Note.md".length); });
});

describe("writeMarkdownAtomically", () => {
  it("creates new file with no conflict", async () => {
    const dir = await mkdtemp(join(tmpdir(), "obsidian-write-"));
    try {
      const r = await writeMarkdownAtomically({ vaultPath: dir, targetDir: "notes", content: "# Test\nHello world.", recordId: "rec1", workId: "dy_001", title: "Test Note", naming: "title-workid" });
      expect(r.success).toBe(true);
      expect(r.conflict).toBe("none");
      const verified = await verifyWrittenNote(r.finalPath, r.hash);
      expect(verified).toBe(true);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it("detects same content same record as same_record", async () => {
    const dir = await mkdtemp(join(tmpdir(), "obsidian-write-"));
    try {
      const content = "# Same";
      const r1 = await writeMarkdownAtomically({ vaultPath: dir, targetDir: "n", content, recordId: "rec1", workId: "dy_001", title: "T", naming: "title" });
      const r2 = await writeMarkdownAtomically({ vaultPath: dir, targetDir: "n", content, recordId: "rec1", workId: "dy_001", title: "T", naming: "title" });
      expect(r2.success).toBe(true);
      expect(r2.conflict).toBe("same_record");
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it("does not overwrite existing file with different content", async () => {
    const dir = await mkdtemp(join(tmpdir(), "obsidian-write-"));
    try {
      const r1 = await writeMarkdownAtomically({ vaultPath: dir, targetDir: "n", content: "# Original", recordId: "rec1", workId: "dy_001", title: "T", naming: "title" });
      const r2 = await writeMarkdownAtomically({ vaultPath: dir, targetDir: "n", content: "# Different", recordId: "rec2", workId: "dy_002", title: "T", naming: "title" });
      expect(r2.success).toBe(true);
      expect(r2.conflict).toBe("different_record");
      expect(r2.finalPath).not.toBe(r1.finalPath);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it("retry does not create duplicate files", async () => {
    const dir = await mkdtemp(join(tmpdir(), "obsidian-write-"));
    try { const content = "# Retry"; const r1 = await writeMarkdownAtomically({ vaultPath: dir, targetDir: "n", content, recordId: "rec1", workId: "dy_001", title: "T", naming: "title" }); const r2 = await writeMarkdownAtomically({ vaultPath: dir, targetDir: "n", content, recordId: "rec1", workId: "dy_001", title: "T", naming: "title" }); const r3 = await writeMarkdownAtomically({ vaultPath: dir, targetDir: "n", content, recordId: "rec1", workId: "dy_001", title: "T", naming: "title" }); expect(r1.finalPath).toBe(r2.finalPath); expect(r2.finalPath).toBe(r3.finalPath); } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it("creates target directory if missing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "obsidian-write-"));
    try { const r = await writeMarkdownAtomically({ vaultPath: dir, targetDir: "deep/nested/notes", content: "# Nested", recordId: "rec1", workId: "dy_001", title: "Test", naming: "title" }); expect(r.success).toBe(true); } finally { await rm(dir, { recursive: true, force: true }); }
  });
  it("detects existing_note_modified when same record but different content", async () => {
    const dir = await mkdtemp(join(tmpdir(), "obsidian-write-"));
    try { const r1 = await writeMarkdownAtomically({ vaultPath: dir, targetDir: "n", content: "# Original", recordId: "rec1", workId: "dy_001", title: "T", naming: "title-workid" }); const r2 = await writeMarkdownAtomically({ vaultPath: dir, targetDir: "n", content: "# Modified by user", recordId: "rec1", workId: "dy_001", title: "T", naming: "title-workid" }); expect(r2.success).toBe(false); expect(r2.conflict).toBe("existing_note_modified"); expect(r2.error).toContain("modified_by_user"); } finally { await rm(dir, { recursive: true, force: true }); }
  });
});
