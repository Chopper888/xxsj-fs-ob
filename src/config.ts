import "dotenv/config";

type Env = Record<string, string | undefined>;

export interface AppConfig {
  feishu: {
    baseToken: string;
    tableId: string;
  };
  douyin: {
    inboxUrl: string;
    messageSelector: string;
    openMessageText?: string;
    openChatText?: string;
    ignoreExistingOnStart: boolean;
    userDataDir: string;
    pollIntervalMs: number;
    headless: boolean;
    offscreen: boolean;
  };
  summary: {
    mode: "mock" | "openai";
    baseUrl: string;
    apiKey?: string;
    model: string;
  };
  video: {
    deepProcessingEnabled: boolean;
    userDataDir: string;
    pythonPath: string;
    whisperScriptPath: string;
    transcriptModel: string;
    transcriptLanguage: string;
    transcriptComputeType: string;
  };
}

function required(env: Env, key: string): string {
  const value = env[key]?.trim();
  if (!value) throw new Error(`missing_env:${key}`);
  return value;
}

function firstDefined(...values: Array<string | undefined>): string | undefined {
  return values.find((value) => value !== undefined && value.trim() !== "");
}

export function loadConfigFromEnv(env: Env = process.env): AppConfig {
  const summaryMode = env.SUMMARY_MODE?.trim() || "mock";
  if (summaryMode !== "mock" && summaryMode !== "openai") {
    throw new Error("invalid_env:SUMMARY_MODE");
  }
  const llmApiKey = firstDefined(env.LLM_API_KEY, env.AGNES_API_KEY);
  if (summaryMode === "openai") {
    if (!llmApiKey) throw new Error("missing_env:LLM_API_KEY");
    if (llmApiKey === "DEEPSEEK_API_KEY_REPLACE_ME") {
      throw new Error("placeholder_api_key:LLM_API_KEY");
    }
  }
  return {
    feishu: {
      baseToken: required(env, "FEISHU_BASE_TOKEN"),
      tableId: required(env, "FEISHU_TABLE_ID"),
    },
    douyin: {
      inboxUrl: env.DOUYIN_INBOX_URL ?? "https://www.douyin.com",
      messageSelector: env.DOUYIN_MESSAGE_SELECTOR ?? '[data-e2e="msg-item-content"]:has([class*="MessageItemShareAwemecontainer"])',
      openMessageText: env.DOUYIN_OPEN_MESSAGE_TEXT ?? "消息",
      openChatText: env.DOUYIN_OPEN_CHAT_TEXT,
      ignoreExistingOnStart: env.DOUYIN_IGNORE_EXISTING_ON_START !== "false",
      userDataDir: env.BROWSER_USER_DATA_DIR ?? ".browser/douyin",
      pollIntervalMs: Number(env.POLL_INTERVAL_MS ?? "5000"),
      headless: env.HEADLESS === "true",
      offscreen: env.DOUYIN_OFFSCREEN === "true",
    },
    summary: {
      mode: summaryMode,
      baseUrl: firstDefined(env.LLM_BASE_URL, env.AGNES_BASE_URL) ?? "https://api.openai.com/v1",
      apiKey: llmApiKey,
      model: firstDefined(env.LLM_MODEL, env.AGNES_MODEL) ?? "gpt-4o-mini",
    },
    video: {
      deepProcessingEnabled: env.VIDEO_DEEP_PROCESSING !== "false",
      userDataDir: env.VIDEO_BROWSER_USER_DATA_DIR ?? env.BROWSER_USER_DATA_DIR ?? ".browser/douyin",
      pythonPath: env.TRANSCRIBE_PYTHON_PATH ?? ".venv/bin/python",
      whisperScriptPath: env.TRANSCRIBE_SCRIPT_PATH ?? "scripts/transcribe-whisper.py",
      transcriptModel: env.TRANSCRIBE_MODEL ?? "base",
      transcriptLanguage: env.TRANSCRIBE_LANGUAGE ?? "zh",
      transcriptComputeType: env.TRANSCRIBE_COMPUTE_TYPE ?? "",
    },
  };
}
