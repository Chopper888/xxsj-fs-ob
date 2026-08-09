import { describe, expect, it } from "vitest";
import { validateDashscopeApiKey, validateObsidianPlatformDirMap, validateEnvAtStartup } from "../../src/config/envValidation.js";

describe("DASHSCOPE_API_KEY validation", () => {
  it("accepts a valid ASCII key", () => {
    expect(validateDashscopeApiKey("sk-abc123def456")).toBe("sk-abc123def456");
  });
  it("rejects missing key", () => {
    expect(() => validateDashscopeApiKey(undefined)).toThrow("DASHSCOPE_API_KEY");
  });
  it("rejects key concatenated with JSON", () => {
    expect(() => validateDashscopeApiKey('sk-test{"a":"b"}')).toThrow("JSON");
  });
  it("rejects key containing Chinese", () => {
    expect(() => validateDashscopeApiKey("sk-key-抖音")).toThrow("non-ASCII");
  });
  it("rejects key containing OBSIDIAN_", () => {
    expect(() => validateDashscopeApiKey("sk-testOBSIDIAN_suffix")).toThrow("OBSIDIAN_");
  });
  it("rejects key with newlines", () => {
    expect(() => validateDashscopeApiKey("sk-a\nb")).toThrow("newlines");
  });
});

describe("OBSIDIAN_PLATFORM_DIR_MAP validation", () => {
  const valid = '{"抖音":"抖音","B站":"B站","小红书":"小红书","推特":"推特","YouTube":"YouTube","公众号":"公众号"}';
  it("accepts valid 6-platform map", () => {
    expect(validateObsidianPlatformDirMap(valid)).toHaveProperty("公众号", "公众号");
  });
  it("rejects invalid JSON", () => {
    expect(() => validateObsidianPlatformDirMap("{broken")).toThrow("valid JSON");
  });
  it("rejects missing public account platform", () => {
    const m = '{"抖音":"抖音","B站":"B站","小红书":"小红书","推特":"推特","YouTube":"YouTube"}';
    expect(() => validateObsidianPlatformDirMap(m)).toThrow("公众号");
  });
  it("rejects missing map entirely", () => {
    expect(() => validateObsidianPlatformDirMap(undefined)).toThrow("missing or empty");
  });
});

describe("startup validation", () => {
  it("passes with valid env", () => {
    expect(() => validateEnvAtStartup({
      DASHSCOPE_API_KEY: "sk-valid",
      OBSIDIAN_PLATFORM_DIR_MAP: '{"抖音":"抖音","B站":"B站","小红书":"小红书","推特":"推特","YouTube":"YouTube","公众号":"公众号"}',
    })).not.toThrow();
  });
  it("throws when API key has Chinese", () => {
    expect(() => validateEnvAtStartup({
      DASHSCOPE_API_KEY: "sk-中文",
      OBSIDIAN_PLATFORM_DIR_MAP: '{"抖音":"抖音","B站":"B站","小红书":"小红书","推特":"推特","YouTube":"YouTube","公众号":"公众号"}',
    })).toThrow();
  });
});
