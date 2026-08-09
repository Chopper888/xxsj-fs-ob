import { describe, expect, it } from "vitest";
import { loadConfigFromEnv } from "../src/config.js";

describe("loadConfigFromEnv", () => {
  it("parses config with defaults", () => {
    const config = loadConfigFromEnv({
      FEISHU_BASE_TOKEN: "base",
      FEISHU_TABLE_ID: "tbl",
    });

    expect(config.feishu.baseToken).toBe("base");
    expect(config.feishu.tableId).toBe("tbl");
    expect(config.douyin.inboxUrl).toBe("https://www.douyin.com");
    expect(config.douyin.messageSelector).toBe('[data-e2e="msg-item-content"]:has([class*="MessageItemShareAwemecontainer"])');
    expect(config.douyin.openMessageText).toBe("消息");
    expect(config.douyin.ignoreExistingOnStart).toBe(true);
    expect(config.douyin.pollIntervalMs).toBe(5000);
    expect(config.douyin.offscreen).toBe(false);
    expect(config.summary.mode).toBe("mock");
    expect(config.video.deepProcessingEnabled).toBe(true);
    expect(config.video.whisperScriptPath).toBe("scripts/transcribe-whisper.py");
    expect(config.video.transcriptModel).toBe("base");
    expect(config.video.transcriptLanguage).toBe("zh");
    expect(config.video.transcriptComputeType).toBe("");
  });

  it("parses offscreen browser mode", () => {
    const config = loadConfigFromEnv({
      FEISHU_BASE_TOKEN: "base",
      FEISHU_TABLE_ID: "tbl",
      DOUYIN_OFFSCREEN: "true",
    });

    expect(config.douyin.offscreen).toBe(true);
  });

  it("allows startup backfill of visible existing messages when explicitly requested", () => {
    const config = loadConfigFromEnv({
      FEISHU_BASE_TOKEN: "base",
      FEISHU_TABLE_ID: "tbl",
      DOUYIN_IGNORE_EXISTING_ON_START: "false",
    });

    expect(config.douyin.ignoreExistingOnStart).toBe(false);
  });

  it("requires Feishu target identifiers", () => {
    expect(() => loadConfigFromEnv({})).toThrow("missing_env:FEISHU_BASE_TOKEN");
  });

  it("allows disabling video deep processing", () => {
    const config = loadConfigFromEnv({
      FEISHU_BASE_TOKEN: "base",
      FEISHU_TABLE_ID: "tbl",
      VIDEO_DEEP_PROCESSING: "false",
    });

    expect(config.video.deepProcessingEnabled).toBe(false);
  });

  it("supports Agnes OpenAI-compatible aliases", () => {
    const config = loadConfigFromEnv({
      FEISHU_BASE_TOKEN: "base",
      FEISHU_TABLE_ID: "tbl",
      SUMMARY_MODE: "openai",
      AGNES_BASE_URL: "https://agnes.example.com/v1",
      AGNES_API_KEY: "agnes-key",
      AGNES_MODEL: "agnes-model",
    });

    expect(config.summary.mode).toBe("openai");
    expect(config.summary.baseUrl).toBe("https://agnes.example.com/v1");
    expect(config.summary.apiKey).toBe("agnes-key");
    expect(config.summary.model).toBe("agnes-model");
  });

  it("rejects real summary mode when the API key is missing", () => {
    expect(() => loadConfigFromEnv({
      FEISHU_BASE_TOKEN: "base",
      FEISHU_TABLE_ID: "tbl",
      SUMMARY_MODE: "openai",
      LLM_BASE_URL: "https://api.deepseek.com/v1",
      LLM_MODEL: "deepseek-chat",
    })).toThrow("missing_env:LLM_API_KEY");
  });

  it("rejects the documented DeepSeek placeholder in real mode", () => {
    expect(() => loadConfigFromEnv({
      FEISHU_BASE_TOKEN: "base",
      FEISHU_TABLE_ID: "tbl",
      SUMMARY_MODE: "openai",
      LLM_BASE_URL: "https://api.deepseek.com/v1",
      LLM_API_KEY: "DEEPSEEK_API_KEY_REPLACE_ME",
      LLM_MODEL: "deepseek-chat",
    })).toThrow("placeholder_api_key:LLM_API_KEY");
  });

  it("does not silently downgrade an invalid requested mode to mock", () => {
    expect(() => loadConfigFromEnv({
      FEISHU_BASE_TOKEN: "base",
      FEISHU_TABLE_ID: "tbl",
      SUMMARY_MODE: "real",
    })).toThrow("invalid_env:SUMMARY_MODE");
  });
});
