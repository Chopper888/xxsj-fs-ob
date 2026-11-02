import { PlatformAdapterError } from "../platform/platformAdapter.js";

export const DOUYIN_CAPTURE_HOUR_MS = 3_600_000;

export interface DouyinRateLimiterOptions {
  maxRequestsPerHour?: number;
  now?: () => number;
}

/**
 * 滑动窗口限流器：控制抖音登录态采集请求 <= 120 次/小时。
 * 超过上限时抛 PlatformAdapterError("rate_limited")，由 worker 识别为可恢复错误并延后处理。
 */
export class DouyinRateLimiter {
  private readonly timestamps: number[] = [];
  private readonly maxPerHour: number;
  private readonly now: () => number;

  constructor(options: DouyinRateLimiterOptions = {}) {
    this.maxPerHour = options.maxRequestsPerHour ?? 120;
    this.now = options.now ?? (() => Date.now());
  }

  remaining(): number {
    return Math.max(0, this.maxPerHour - this.activeCount());
  }

  consume(): void {
    if (this.activeCount() >= this.maxPerHour) {
      const oldest = this.timestamps[0];
      const retryAfterSeconds = Math.max(0, Math.ceil((oldest + DOUYIN_CAPTURE_HOUR_MS - this.now()) / 1000));
      throw new PlatformAdapterError("rate_limited", `douyin_capture_rate_limit:retry_after_${retryAfterSeconds}s`);
    }
    this.timestamps.push(this.now());
  }

  private activeCount(): number {
    const cutoff = this.now() - DOUYIN_CAPTURE_HOUR_MS;
    while (this.timestamps.length > 0 && this.timestamps[0] < cutoff) this.timestamps.shift();
    return this.timestamps.length;
  }
}

export const douyinCaptureRateLimiter = new DouyinRateLimiter();
