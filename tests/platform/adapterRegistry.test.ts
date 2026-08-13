import { describe, expect, it } from "vitest";
import { AdapterRegistry, AdapterRegistryError } from "../../src/platform/adapterRegistry.js";
import type { PlatformAdapter, PlatformInput } from "../../src/platform/platformAdapter.js";

function fake(platform: PlatformAdapter["platform"], host: string): PlatformAdapter {
  return {
    platform,
    canHandle: (input: PlatformInput) => input.sourceUrl.includes(host),
    normalizeUrl: async (input) => ({ sourceUrl: input.sourceUrl, canonicalUrl: input.sourceUrl }),
    resolveIdentity: async (normalized) => ({
      platform, platformContentId: "1", sourceUrl: normalized.sourceUrl,
      canonicalUrl: normalized.canonicalUrl, dedupeKey: `${platform}:1`,
    }),
    resolveContent: async (identity) => ({ identity, contentType: "post", texts: [], media: [], links: [] }),
  };
}

describe("AdapterRegistry", () => {
  it("selects the unique adapter and accepts the matching Base Chinese platform", () => {
    const registry = new AdapterRegistry([fake("douyin", "douyin.com")]);
    expect(registry.resolve({ sourceUrl: "https://www.douyin.com/video/12345678", declaredPlatform: "抖音" }).platform).toBe("douyin");
  });

  it("rejects unsupported URLs", () => {
    const registry = new AdapterRegistry([fake("douyin", "douyin.com")]);
    expect(() => registry.resolve({ sourceUrl: "https://example.com/post/1" })).toThrowError(
      expect.objectContaining<Partial<AdapterRegistryError>>({ code: "unsupported_platform" }),
    );
  });

  it("rejects ambiguous matches independent of registration order", () => {
    for (const adapters of [
      [fake("douyin", "douyin.com"), fake("bilibili", "douyin.com")],
      [fake("bilibili", "douyin.com"), fake("douyin", "douyin.com")],
    ]) {
      expect(() => new AdapterRegistry(adapters).resolve({ sourceUrl: "https://douyin.com/video/12345678" }))
        .toThrowError(expect.objectContaining<Partial<AdapterRegistryError>>({ code: "ambiguous_platform_adapter" }));
    }
  });

  it("rejects a Base platform declaration that conflicts with the URL", () => {
    const registry = new AdapterRegistry([fake("douyin", "douyin.com")]);
    expect(() => registry.resolve({ sourceUrl: "https://douyin.com/video/12345678", declaredPlatform: "B站" }))
      .toThrowError(expect.objectContaining<Partial<AdapterRegistryError>>({ code: "platform_mismatch" }));
  });
});
