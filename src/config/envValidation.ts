export function validateDashscopeApiKey(value: string | undefined): string {
  if (!value?.trim()) throw new Error("env_validation:DASHSCOPE_API_KEY is missing or empty");
  const key = value.trim();
  if (/[^\x00-\x7F]/.test(key)) throw new Error("env_validation:DASHSCOPE_API_KEY contains non-ASCII characters");
  if (/[\r\n]/.test(key)) throw new Error("env_validation:DASHSCOPE_API_KEY contains newlines");
  if (/[{}]/.test(key)) throw new Error("env_validation:DASHSCOPE_API_KEY appears concatenated with JSON");
  if (/OBSIDIAN_/i.test(key)) throw new Error("env_validation:DASHSCOPE_API_KEY appears concatenated with OBSIDIAN_ variable");
  if (/[\u4e00-\u9fff]/.test(key)) throw new Error("env_validation:DASHSCOPE_API_KEY contains Chinese characters");
  return key;
}

const REQUIRED_PLATFORMS = ["抖音", "B站", "小红书", "推特", "YouTube", "公众号"] as const;

export function validateObsidianPlatformDirMap(value: string | undefined): Record<string, string> {
  if (!value?.trim()) throw new Error("env_validation:OBSIDIAN_PLATFORM_DIR_MAP is missing or empty");
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch { throw new Error("env_validation:OBSIDIAN_PLATFORM_DIR_MAP is not valid JSON"); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("env_validation:OBSIDIAN_PLATFORM_DIR_MAP must be a JSON object");
  const map = parsed as Record<string, unknown>;
  for (const [k, v] of Object.entries(map)) {
    if (typeof v !== "string") throw new Error("env_validation:OBSIDIAN_PLATFORM_DIR_MAP value not string");
    if (!v.trim()) throw new Error("env_validation:OBSIDIAN_PLATFORM_DIR_MAP has empty value");
  }
  for (const p of REQUIRED_PLATFORMS) {
    if (!map[p]) throw new Error("env_validation:OBSIDIAN_PLATFORM_DIR_MAP is missing platform: " + p);
  }
  if (/^sk-/i.test(Object.keys(map)[0])) throw new Error("env_validation:OBSIDIAN_PLATFORM_DIR_MAP appears concatenated with API key");
  return map as Record<string, string>;
}

export function validateEnvAtStartup(env: Record<string, string | undefined> = process.env): void {
  validateDashscopeApiKey(env.DASHSCOPE_API_KEY);
  validateObsidianPlatformDirMap(env.OBSIDIAN_PLATFORM_DIR_MAP);
}
