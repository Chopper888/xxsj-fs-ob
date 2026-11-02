import { describe, expect, it } from "vitest";
import { browserLaunchArgs } from "../../src/monitor/browserLaunchArgs.js";

describe("browserLaunchArgs", () => {
  it("minimizes headed offscreen Chromium windows", () => {
    expect(browserLaunchArgs({ headless: false, offscreen: true })).toEqual(
      expect.arrayContaining(["--window-position=-32000,-32000", "--window-size=900,700", "--start-minimized"]),
    );
  });

  it("does not add window flags in real headless mode", () => {
    expect(browserLaunchArgs({ headless: true, offscreen: true })).not.toContain("--start-minimized");
  });
});
