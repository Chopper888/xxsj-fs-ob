import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

export interface ObsidianVaultCandidate {
  name: string;
  path: string;
  hasObsidianDir: boolean;
  writable: boolean;
  mdFileCount: number;
  syncDir: boolean;
  subdirectories: string[];
}

const SEARCH_ROOTS: string[] = [
  join(homedir(), "Documents"),
  join(homedir(), "Desktop"),
  homedir(),
  "D:/",
  "E:/",
  "H:/",
];

const MAX_DEPTH = 3;
const SKIP_PREFIXES = [".", "node_modules", "$RECYCLE.BIN", "System Volume Information"];

function shouldSkip(name: string): boolean {
  if (name === ".obsidian") return false;
  return SKIP_PREFIXES.some((p) => name.startsWith(p));
}

async function scanForObsidian(dir: string, depth: number, results: Set<string>): Promise<void> {
  if (depth > MAX_DEPTH) return;
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    if (!entry.isDirectory() || shouldSkip(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.name === ".obsidian") { results.add(dir); continue; }
    await scanForObsidian(full, depth + 1, results);
  }
}

async function countMdFiles(dir: string): Promise<number> {
  try { const entries = await readdir(dir, { withFileTypes: true }); return entries.filter((e) => e.isFile() && e.name.endsWith(".md")).length; } catch { return 0; }
}

async function listSubdirs(dir: string): Promise<string[]> {
  try { const entries = await readdir(dir, { withFileTypes: true }); return entries.filter((e) => e.isDirectory() && !e.name.startsWith(".")).map((e) => e.name); } catch { return []; }
}

async function isWritable(dir: string): Promise<boolean> {
  try { await stat(dir); const testFile = join(dir, ".codex-write-test-" + Date.now()); const { writeFile, unlink } = await import("node:fs/promises"); await writeFile(testFile, "test", "utf8"); await unlink(testFile); return true; } catch { return false; }
}

export async function discoverObsidianVaults(extraRoots: string[] = []): Promise<ObsidianVaultCandidate[]> {
  const found = new Set<string>();
  const roots = extraRoots.length > 0 ? extraRoots : SEARCH_ROOTS;
  for (const root of roots) { await scanForObsidian(root, 1, found); }
  const candidates: ObsidianVaultCandidate[] = [];
  for (const path of [...found]) {
    const writable = await isWritable(path);
    const mdFileCount = await countMdFiles(path);
    const subdirectories = await listSubdirs(path);
    const syncDir = path.includes("OneDrive") || path.includes("iCloud") || path.includes("Dropbox");
    const name = path.split(/[\\/]/).filter(Boolean).pop() || path;
    candidates.push({ name, path, hasObsidianDir: true, writable, mdFileCount, syncDir, subdirectories });
  }
  return candidates;
}
