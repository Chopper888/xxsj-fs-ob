import { describe, expect, it } from "vitest";
import { resolveRuntimePaths } from "../../src/config/runtimePaths.js";

describe("runtime path injection", () => {
  it("prefers an explicitly injected vault path", () => {
    expect(resolveRuntimePaths({ obsidianVaultPath: "X:/synthetic/vault" }, { OBSIDIAN_VAULT_PATH: "Y:/env/vault" }).obsidianVaultPath).toBe("X:/synthetic/vault");
  });

  it("falls back to the public environment variable", () => {
    expect(resolveRuntimePaths({}, { OBSIDIAN_VAULT_PATH: "Y:/env/vault" }).obsidianVaultPath).toBe("Y:/env/vault");
  });

  it("fails clearly when neither source provides a vault path", () => {
    expect(() => resolveRuntimePaths({}, {})).toThrow("obsidian_vault_path_required");
  });
});

