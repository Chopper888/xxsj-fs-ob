export interface RuntimePathsInput { obsidianVaultPath?: string }
export interface RuntimePaths { obsidianVaultPath: string }

export function resolveRuntimePaths(input: RuntimePathsInput = {}, env: Record<string, string | undefined> = process.env): RuntimePaths {
  const obsidianVaultPath = input.obsidianVaultPath?.trim() || env.OBSIDIAN_VAULT_PATH?.trim();
  if (!obsidianVaultPath) throw new Error("obsidian_vault_path_required");
  return { obsidianVaultPath };
}

