import { join } from "node:path";
import { AdapterRegistry } from "../adapterRegistry.js";
import type { MaterializedMedia, PlatformIdentity } from "../types.js";
import { DouyinAdapter, type CaptureMedia } from "./douyinAdapter.js";

export interface DouyinWorkerPlatformBridgeOptions { root: string; captureMedia?: CaptureMedia }
export interface ResolveWorkerPlatformInput { sourceUrl: string; declaredPlatform: string; dedupeKey?: string; taskDir: string; signal?: AbortSignal }

export function createDouyinWorkerPlatformBridge(options: DouyinWorkerPlatformBridgeOptions) {
  const adapter = new DouyinAdapter({ captureMedia: options.captureMedia, userDataDir: join(options.root, ".browser", "douyin"), headless: false, timeoutMs: 30000 });
  const registry = new AdapterRegistry([adapter]);
  return {
    async resolveAndMaterialize(input: ResolveWorkerPlatformInput): Promise<{ identity: PlatformIdentity; media: MaterializedMedia }> {
      const platformInput = { sourceUrl: input.sourceUrl, declaredPlatform: input.declaredPlatform, dedupeKey: input.dedupeKey };
      const selected = registry.resolve(platformInput);
      const context = { taskDir: input.taskDir, signal: input.signal ?? new AbortController().signal, logger: { info: (_message: string) => undefined, warn: (_message: string) => undefined } };
      const normalized = await selected.normalizeUrl(platformInput, context);
      const identity = await selected.resolveIdentity(normalized, context);
      const content = await selected.resolveContent(identity, context);
      if (!selected.materializeMedia) throw new Error("platform_media_materializer_missing");
      const media = (await selected.materializeMedia(content, context))[0];
      if (!media) throw new Error("platform_media_missing");
      return { identity, media };
    },
  };
}
