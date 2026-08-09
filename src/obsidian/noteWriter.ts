import { validateObsidianPlatformDirMap } from "../config/envValidation.js";
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
export interface NoteWriteInput { vaultPath: string; targetDir: string; content: string; recordId: string; workId: string; title: string; naming: "title" | "date-title" | "title-workid"; }
export interface NoteWriteResult { success: boolean; finalPath: string; hash: string; conflict: "none" | "same_record" | "different_record" | "existing_note_modified" | "skip"; error?: string; }
const MAX_FILENAME_LENGTH = 180; const ILLEGAL_CHARS = /[<>:"/\\|?*]/g;
export function sanitizeNoteFilename(raw: string): string { let s = raw.replace(ILLEGAL_CHARS, "-").replace(/\s+/g, " ").replace(/\.{2,}/g, ".").replace(/\s*\.\s*/g, ".").replace(/^\.+|\.+$/g, "").replace(/\s+$/g, "").trim(); if (s.length > MAX_FILENAME_LENGTH) s = s.slice(0, MAX_FILENAME_LENGTH - 8) + "-" + createHash("sha256").update(s).digest("hex").slice(0, 7); return s || "untitled-note"; }
export function buildNoteFilename(title: string, workId: string, publishDate: string, naming: NoteWriteInput["naming"]): string { const ct = sanitizeNoteFilename(title); const ws = workId.replace(/[^a-zA-Z0-9]/g, "").slice(-8); switch (naming) { case "title": return `${ct}.md`; case "date-title": return `${publishDate || "nodate"} - ${ct}.md`; case "title-workid": return `${ct} - ${ws}.md`; } }
export function sha256(content: string): string { return createHash("sha256").update(content, "utf8").digest("hex"); }
async function safeRead(path: string): Promise<string | null> { try { return await readFile(path, "utf8"); } catch { return null; } }
export async function writeMarkdownAtomically(input: NoteWriteInput): Promise<NoteWriteResult> {
  const filename = buildNoteFilename(input.title, input.workId, "", input.naming);
  const hash = sha256(input.content);
  await mkdir(join(input.vaultPath, input.targetDir), { recursive: true });
  const finalPath = join(input.vaultPath, input.targetDir, filename);
  const existing = await safeRead(finalPath);
  if (existing !== null) {
    const existingHash = sha256(existing);
    if (existingHash === hash) return { success: true, finalPath, hash, conflict: "same_record" };
    const wIdDigits = input.workId.replace(/[^0-9]/g, "").slice(-8);
    const fileHasWorkId = filename.includes(wIdDigits) || existing.includes(wIdDigits);
    if (fileHasWorkId) return { success: false, finalPath, hash, conflict: "existing_note_modified", error: "existing_note_modified_by_user" };
    const contentId = sha256(input.recordId + input.workId);
    const ddFn = filename.replace(/\.md$/, ` - ${contentId.slice(0, 8)}.md`);
    const ddPath = join(input.vaultPath, input.targetDir, ddFn);
    const ddEx = await safeRead(ddPath);
    if (ddEx !== null && sha256(ddEx) === hash) return { success: true, finalPath: ddPath, hash, conflict: "same_record" };
    const tmpP = join(input.vaultPath, input.targetDir, `.tmp-${Date.now()}-${hash.slice(0, 8)}.md`);
    await writeFile(tmpP, input.content, "utf8"); const wr = await safeRead(tmpP); if (!wr || sha256(wr) !== hash) { try { await unlink(tmpP); } catch {} return { success: false, finalPath: "", hash, conflict: "skip", error: "hash_mismatch_after_write" }; }
    try { await rename(tmpP, ddPath); } catch (err) { try { await unlink(tmpP); } catch {} return { success: false, finalPath: "", hash, conflict: "skip", error: `rename_failed:${String(err)}` }; }
    const rn = await safeRead(ddPath); if (!rn || sha256(rn) !== hash) return { success: false, finalPath: ddPath, hash, conflict: "skip", error: "hash_mismatch_after_rename" };
    return { success: true, finalPath: ddPath, hash, conflict: "different_record" };
  }
  const tmpP = join(input.vaultPath, input.targetDir, `.tmp-${Date.now()}-${hash.slice(0, 8)}.md`);
  await writeFile(tmpP, input.content, "utf8"); const wr = await safeRead(tmpP); if (!wr || sha256(wr) !== hash) { try { await unlink(tmpP); } catch {} return { success: false, finalPath: "", hash, conflict: "none", error: "hash_mismatch_after_write" }; }
  try { await rename(tmpP, finalPath); } catch (err) { try { await unlink(tmpP); } catch {} return { success: false, finalPath: "", hash, conflict: "none", error: `rename_failed:${String(err)}` }; }
  const rn = await safeRead(finalPath); if (!rn || sha256(rn) !== hash) return { success: false, finalPath, hash, conflict: "none", error: "hash_mismatch_after_rename" };
  return { success: true, finalPath, hash, conflict: "none" };
}
export async function verifyWrittenNote(filePath: string, expectedHash: string): Promise<boolean> { const c = await safeRead(filePath); return c !== null && sha256(c) === expectedHash; }
export function resolvePlatformDir(platform: string): string { const map = validateObsidianPlatformDirMap(process.env.OBSIDIAN_PLATFORM_DIR_MAP); return map[platform] || platform; }
export function resolveNoteDestination(vaultPath: string, platform: string): string { const inbox = (process.env.OBSIDIAN_INBOX_DIR || "000-Inbox").replace(/[\\/]+$/, ""); return join(vaultPath, inbox, resolvePlatformDir(platform)); }
export function buildNoteFilenameV2(title: string, workId: string): string { const ct = sanitizeNoteFilename(title); const id = workId.replace(/[^0-9]/g, "").slice(-8); return `${ct} - ${id}.md`; }
export interface BaseWritebackInput { recordId: string; knowledgePath: string; completedAt: string; }
export async function commitObsidianAndBaseState(noteResult: NoteWriteResult, baseWriteback: (input: BaseWritebackInput) => Promise<boolean>): Promise<{ obsidian: boolean; base: boolean; recoverable: boolean }> { if (!noteResult.success) return { obsidian: false, base: false, recoverable: true }; const baseOk = await baseWriteback({ recordId: "", knowledgePath: noteResult.finalPath, completedAt: new Date().toISOString() }); return { obsidian: true, base: baseOk, recoverable: !baseOk }; }
