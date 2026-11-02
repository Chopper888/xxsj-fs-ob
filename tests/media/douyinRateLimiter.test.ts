import { describe, expect, it } from "vitest";
import { douyinCaptureRateLimiter, DouyinRateLimiter } from "../../src/media/douyinRateLimiter.js";
import { PlatformAdapterError } from "../../src/platform/platformAdapter.js";

const HOUR = 3_600_000;

describe("DouyinRateLimiter 滑动窗口（默认 120 次/小时）", () => {
  it("允许每小时前 120 次请求，第 121 次触发 rate_limited", () => {
    let t = 1_000_000;
    const limiter = new DouyinRateLimiter({ maxRequestsPerHour: 120, now: () => t });
    for (let i = 0; i < 120; i++) limiter.consume();
    expect(limiter.remaining()).toBe(0);
    expect(() => limiter.consume()).toThrowError(PlatformAdapterError);
    expect(() => limiter.consume()).toThrowError(/rate_limit/);
  });

  it("被拒绝的请求不记录，remaining 保持不变", () => {
    let t = 1_000_000;
    const limiter = new DouyinRateLimiter({ maxRequestsPerHour: 3, now: () => t });
    limiter.consume();
    limiter.consume();
    limiter.consume();
    expect(() => limiter.consume()).toThrowError(PlatformAdapterError);
    expect(limiter.remaining()).toBe(0);
  });

  it("窗口滑动：最早请求滑出 1 小时后恢复", () => {
    let t = 1_000_000;
    const limiter = new DouyinRateLimiter({ maxRequestsPerHour: 3, now: () => t });
    limiter.consume();
    limiter.consume();
    limiter.consume();
    expect(() => limiter.consume()).toThrowError(PlatformAdapterError);
    t += HOUR;
    expect(limiter.remaining()).toBe(0);
    t += 1;
    expect(limiter.remaining()).toBe(3);
    limiter.consume();
  });

  it("窗口边界：窗口内仍满时继续拒绝，滑出才放行", () => {
    let t = 1_000_000;
    const limiter = new DouyinRateLimiter({ maxRequestsPerHour: 2, now: () => t });
    limiter.consume();
    t += HOUR - 1;
    limiter.consume();
    expect(() => limiter.consume()).toThrowError(PlatformAdapterError);
    t += 2;
    expect(limiter.remaining()).toBe(1);
    limiter.consume();
  });

  it("错误码为 rate_limited，worker 生命周期可识别为重试性错误", () => {
    let t = 1_000_000;
    const limiter = new DouyinRateLimiter({ maxRequestsPerHour: 1, now: () => t });
    limiter.consume();
    let thrown: unknown;
    try {
      limiter.consume();
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(PlatformAdapterError);
    expect((thrown as PlatformAdapterError).code).toBe("rate_limited");
    expect((thrown as Error).message).toMatch(/rate_limit/i);
  });

  it("默认单例为 120 次/小时", () => {
    expect(douyinCaptureRateLimiter).toBeInstanceOf(DouyinRateLimiter);
  });
});
