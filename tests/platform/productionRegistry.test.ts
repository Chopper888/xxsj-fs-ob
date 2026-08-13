import { describe, expect, it } from "vitest";
import { createProductionAdapterRegistry } from "../../src/platform/productionRegistry.js";

describe("production adapter registry", () => {
  it("routes Douyin and WeChat through the same registry", () => {
    const registry = createProductionAdapterRegistry({
      projectRoot: process.cwd(),
      douyinCapture: async () => ({ id: "1234567890123456789", outputPath: "a.mp4", resolvedUrl: "https://cdn.test/a.mp4", bytes: 1, candidateCount: 1 }),
      wechatCapture: async () => { throw new Error("unused"); },
    });
    expect(registry.resolve({ sourceUrl: "https://www.douyin.com/video/1234567890123456789", declaredPlatform: "抖音" }).platform).toBe("douyin");
    expect(registry.resolve({ sourceUrl: "https://mp.weixin.qq.com/s/abc", declaredPlatform: "公众号" }).platform).toBe("wechat_official_account");
  });
  it("rejects declared-platform mismatches and unsupported URLs", () => {
    const registry = createProductionAdapterRegistry({ projectRoot: process.cwd() });
    expect(() => registry.resolve({ sourceUrl: "https://mp.weixin.qq.com/s/abc", declaredPlatform: "抖音" })).toThrow("platform_mismatch");
    expect(() => registry.resolve({ sourceUrl: "https://www.douyin.com/video/1234567890123456789", declaredPlatform: "公众号" })).toThrow("platform_mismatch");
    expect(() => registry.resolve({ sourceUrl: "https://example.com/article", declaredPlatform: "公众号" })).toThrow("unsupported_platform");
  });
});
