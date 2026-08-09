import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { discoverObsidianVaults } from "../../src/obsidian/vaultDiscovery.js";

async function touchObsidian(dir: string) { await mkdir(join(dir, ".obsidian"), { recursive: true }); await writeFile(join(dir, ".obsidian", "app.json"), "{}", "utf8"); }

describe("discoverObsidianVaults with test-only roots", () => {
  it("finds vault with .obsidian in given root", async () => {
    const dir = await mkdtemp(join(tmpdir(), "obs-"));
    try { await mkdir(join(dir, "vault"), { recursive: true }); await touchObsidian(join(dir, "vault")); const c = await discoverObsidianVaults([dir]); expect(c.length).toBeGreaterThanOrEqual(1); expect(c[0]?.hasObsidianDir).toBe(true); } finally { await rm(dir, { recursive: true, force: true }); }
  });
  it("returns empty when no .obsidian anywhere", async () => {
    const dir = await mkdtemp(join(tmpdir(), "obs-"));
    try { const c = await discoverObsidianVaults([dir]); expect(c.length).toBe(0); } finally { await rm(dir, { recursive: true, force: true }); }
  });
  it("skips node_modules even if it contains .obsidian", async () => {
    const dir = await mkdtemp(join(tmpdir(), "obs-"));
    try { await mkdir(join(dir, "node_modules", "pkg"), { recursive: true }); await touchObsidian(join(dir, "node_modules", "pkg")); const c = await discoverObsidianVaults([dir]); expect(c.length).toBe(0); } finally { await rm(dir, { recursive: true, force: true }); }
  });
  it("reports writable status", async () => {
    const dir = await mkdtemp(join(tmpdir(), "obs-"));
    try { await mkdir(join(dir, "vault"), { recursive: true }); await touchObsidian(join(dir, "vault")); const c = await discoverObsidianVaults([dir]); const v = c.find((x) => x.path === join(dir, "vault")); expect(v?.writable).toBe(true); } finally { await rm(dir, { recursive: true, force: true }); }
  });
  it("lists subdirectories without dot-prefixed", async () => {
    const dir = await mkdtemp(join(tmpdir(), "obs-"));
    try { const vd = join(dir, "vault"); await mkdir(vd, { recursive: true }); await touchObsidian(vd); await mkdir(join(vd, "Notes"), { recursive: true }); await writeFile(join(vd, "Notes", "x.md"), "# t", "utf8"); await mkdir(join(vd, "Inbox"), { recursive: true }); await writeFile(join(vd, "Inbox", "y.md"), "# i", "utf8"); const c = await discoverObsidianVaults([dir]); const v = c.find((x) => x.path === vd); expect(v?.subdirectories).toContain("Notes"); expect(v?.subdirectories).toContain("Inbox"); expect(v?.subdirectories).not.toContain(".obsidian"); } finally { await rm(dir, { recursive: true, force: true }); }
  });
  it("detects sync directories via path contains OneDrive", async () => {
    const dir = await mkdtemp(join(tmpdir(), "obs-"));
    try { const vd = join(dir, "OneDrive", "vault"); await mkdir(vd, { recursive: true }); await touchObsidian(vd); const c = await discoverObsidianVaults([dir]); const v = c.find((x) => x.path === vd); expect(v?.syncDir).toBe(true); } finally { await rm(dir, { recursive: true, force: true }); }
  });
});
