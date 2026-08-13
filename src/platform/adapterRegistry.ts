import type { PlatformAdapter, PlatformInput } from "./platformAdapter.js";
import type { PlatformId } from "./types.js";

const BASE_PLATFORM_MAP: Record<string, PlatformId> = { "抖音": "douyin", "公众号": "wechat_official_account", "B站": "bilibili", "X": "x", "推特": "x" };
export type AdapterRegistryErrorCode = "unsupported_platform" | "ambiguous_platform_adapter" | "platform_mismatch" | "unknown_declared_platform";
export class AdapterRegistryError extends Error {
  constructor(public readonly code: AdapterRegistryErrorCode, message: string = code) { super(message); this.name = "AdapterRegistryError"; }
}

export class AdapterRegistry {
  constructor(private readonly adapters: readonly PlatformAdapter[]) {}
  resolve(input: PlatformInput): PlatformAdapter {
    const matches = this.adapters.filter((adapter) => adapter.canHandle(input));
    if (matches.length === 0) throw new AdapterRegistryError("unsupported_platform");
    if (matches.length !== 1) throw new AdapterRegistryError("ambiguous_platform_adapter");
    if (input.declaredPlatform?.trim()) {
      const declared = BASE_PLATFORM_MAP[input.declaredPlatform.trim()];
      if (!declared) throw new AdapterRegistryError("unknown_declared_platform");
      if (declared !== matches[0].platform) throw new AdapterRegistryError("platform_mismatch");
    }
    return matches[0];
  }
}
