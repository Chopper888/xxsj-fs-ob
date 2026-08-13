import { describe, expect, it, vi } from "vitest";
import { createDouyinWorkerPlatformBridge } from "../../src/platform/douyin/workerPlatformBridge.js";

describe("Douyin worker platform bridge", () => {
  it("routes the existing Base task through Registry and materializes the existing media artifact", async () => {
    const capture = vi.fn().mockResolvedValue({ id: "7650000000000000000", outputPath: "ignored", bytes: 42, candidateCount: 1, resolvedUrl: "https://media.example/video" });
    const bridge = createDouyinWorkerPlatformBridge({ root: "C:/synthetic/root", captureMedia: capture });
    const result = await bridge.resolveAndMaterialize({
      sourceUrl: "https://www.douyin.com/video/7650000000000000000",
      declaredPlatform: "抖音", dedupeKey: "aweme:7650000000000000000",
      taskDir: "C:/synthetic/root/data/tasks/rec1234567890",
    });
    expect(result.identity.dedupeKey).toBe("aweme:7650000000000000000");
    expect(result.media).toMatchObject({ mediaUrl: "https://media.example/video", bytes: 42 });
    expect(capture).toHaveBeenCalledTimes(1);
  });
});
