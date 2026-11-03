export const DEFAULT_PRIMARY_CATEGORIES = [
  "AI Agent/编程",
  "Skill/插件/模型",
  "ComfyUI/AI绘画",
  "AI行业动态/资讯",
  "其他",
];

export async function resolvePrimaryCategories(
  readOptions: () => string[] | Promise<string[]>,
  warn: (message: string) => void,
): Promise<string[]> {
  try {
    const options = [...new Set((await readOptions()).map((option) => option.trim()).filter(Boolean))];
    if (options.length) return options;
    warn("[config] 「一级标签」字段没有可用选项，回退默认分类");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    warn(`[config] 读取「一级标签」字段选项失败，回退默认分类: ${message}`);
  }
  return [...DEFAULT_PRIMARY_CATEGORIES];
}
