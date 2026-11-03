import { describe, expect, it, vi } from "vitest";
import { DEFAULT_PRIMARY_CATEGORIES, resolvePrimaryCategories } from "../../src/analysis/primaryCategories.js";

describe("primary categories from Base field options", () => {
  it("uses the table options and preserves their order", async () => {
    const options = ["ComfyUI/AI绘画", "AI Agent/编程", "飞书/效率工具/自动化", "其他"];
    await expect(resolvePrimaryCategories(() => options, vi.fn())).resolves.toEqual(options);
  });

  it("trims, removes blanks and de-duplicates options", async () => {
    await expect(resolvePrimaryCategories(() => [" AI Agent/编程 ", "", "AI Agent/编程", "其他"], vi.fn()))
      .resolves.toEqual(["AI Agent/编程", "其他"]);
  });

  it("falls back to the default list and warns when reading fails", async () => {
    const warn = vi.fn();
    await expect(resolvePrimaryCategories(() => { throw new Error("lark_timeout"); }, warn))
      .resolves.toEqual(DEFAULT_PRIMARY_CATEGORIES);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("lark_timeout"));
  });

  it("falls back to the default list when the field has no options", async () => {
    const warn = vi.fn();
    await expect(resolvePrimaryCategories(() => [], warn)).resolves.toEqual(DEFAULT_PRIMARY_CATEGORIES);
    expect(warn).toHaveBeenCalled();
  });
});
