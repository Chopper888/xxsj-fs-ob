# Project Agent Guide / 项目 Agent 指南

This file is the project-specific source of truth for AI agents working in this repository.

这是本仓库的项目级 AI 协作规则源文件。

## Scope / 范围

- Project root: this repository root.
- Runtime: TypeScript Node.js CLI, Playwright, Vitest, pnpm.
- Main command: `pnpm monitor`.
- Checks: `pnpm test` and `pnpm typecheck`.

- 项目根目录：本仓库根目录。
- 运行时：TypeScript Node.js CLI、Playwright、Vitest、pnpm。
- 主命令：`pnpm monitor`。
- 检查命令：`pnpm test` 和 `pnpm typecheck`。

## Safety / 安全

- Never print or commit `.env`, Feishu tokens, LLM API keys, browser cookies, or Playwright profile contents.
- `.env`, `.browser/`, `data/`, and `logs/` are local runtime state and must stay out of git.
- Keep `.env.example` with blank secrets only.
- Do not log full private message text unless the user explicitly asks for a local debugging readout.

- 不要打印或提交 `.env`、飞书 token、LLM API Key、浏览器 Cookie、Playwright 用户目录内容。
- `.env`、`.browser/`、`data/`、`logs/` 是本地运行状态，必须留在 git 外。
- `.env.example` 只能保留空白密钥占位。
- 除非用户明确要求本地调试输出，不要在日志里输出完整私信正文。

## Douyin Monitor Rules / 抖音监控规则

- Prefer `HEADLESS=false` with `DOUYIN_OFFSCREEN=true`. Pure `HEADLESS=true` can trigger Douyin verification pages.
- First login can use `DOUYIN_OFFSCREEN=false pnpm monitor`; normal use should run `pnpm monitor`.
- Use `BROWSER_USER_DATA_DIR=.browser/douyin` to preserve login state.
- `DOUYIN_OPEN_CHAT_TEXT` should be the visible self-chat name when auto-opening the target conversation.
- The monitor intentionally ignores visible existing messages on startup when `DOUYIN_IGNORE_EXISTING_ON_START=true`.
- Browser-mediated media capture lives in `src/media/douyinMediaCapture.ts`. It may save local media files, but must not print or persist signed media URLs, request headers, cookies, or session values.
- Canonical public video links use `https://www.douyin.com/jingxuan?modal_id=<aweme_id>`. Media capture must use the exact matching detail response and fail instead of falling back to unverified page media.
- Captured media must contain an audio stream before transcription.
- Use local OpenAI Whisper through `scripts/transcribe-whisper.py` for transcription.
- Default Whisper model is `base`; use `tiny` only for very quick smoke tests.
- `TRANSCRIBE_COMPUTE_TYPE` is kept for queue compatibility but ignored by the OpenAI Whisper backend.
- Convert Whisper transcripts and generated summaries from Traditional to Simplified Chinese before Feishu writeback.
- Video deep processing is internal async queue work. `pnpm monitor` enqueues video records after Feishu write succeeds, then `VideoDeepProcessor` updates the same record by `去重 ID`.
- Agnes AI can be used through the OpenAI-compatible summary path with `SUMMARY_MODE=openai` plus `AGNES_BASE_URL`, `AGNES_API_KEY`, and `AGNES_MODEL`. Never commit these values.

- 优先使用 `HEADLESS=false` 加 `DOUYIN_OFFSCREEN=true`。纯 `HEADLESS=true` 可能触发抖音验证页。
- 首次登录可用 `DOUYIN_OFFSCREEN=false pnpm monitor`；日常使用运行 `pnpm monitor`。
- 使用 `BROWSER_USER_DATA_DIR=.browser/douyin` 保留登录态。
- `DOUYIN_OPEN_CHAT_TEXT` 应填写自己会话在列表里的可见名称，用于自动打开目标会话。
- `DOUYIN_IGNORE_EXISTING_ON_START=true` 时，启动时可见的旧消息会被忽略。
- 浏览器媒体捕获逻辑在 `src/media/douyinMediaCapture.ts`。可以保存本地媒体文件，但不要打印或持久化签名媒体直链、请求头、Cookie 或会话值。
- 公开作品链接统一使用 `https://www.douyin.com/jingxuan?modal_id=<aweme_id>`。媒体捕获必须使用精确匹配的详情响应；无法核验时直接失败，不使用页面媒体兜底。
- 转写前必须确认下载媒体包含音轨。
- 本地转写使用 `scripts/transcribe-whisper.py` 调用 OpenAI Whisper。
- Whisper 默认模型是 `base`；只有快速冒烟时才临时用 `tiny`。
- `TRANSCRIBE_COMPUTE_TYPE` 为队列兼容保留，OpenAI Whisper 后端会忽略它。
- 飞书回写前，把 Whisper 转写和生成摘要中的繁体中文转换为简体中文。
- 视频深度处理是内部异步队列。`pnpm monitor` 在飞书写入成功后入队视频记录，再由 `VideoDeepProcessor` 按 `去重 ID` 更新同一条记录。
- Agnes AI 通过 OpenAI-compatible 摘要路径接入：`SUMMARY_MODE=openai` 加 `AGNES_BASE_URL`、`AGNES_API_KEY`、`AGNES_MODEL`。不要提交这些值。

## Feishu Field Contract / 飞书字段契约

The current MVP writes these fields only:

当前 MVP 只写入这些字段：

```text
标题
内容类型
原始链接
原始文本
作者/来源
摘要
捕获时间
处理状态
去重 ID
错误信息
知识库链接
```

- Do not reintroduce Feishu fields `关键点` or `标签` unless the user asks for them again.
- For video share cards, `标题` should come from the expanded Douyin caption. Exclude author metadata, publish time, collection text, and overlay controls such as `识别画面` and `个人观点，仅供参考`.
- Video records write an empty `摘要` at first. After async deep processing succeeds, update `原始文本` with transcript text, `摘要` with transcript-based summary, and `处理状态=transcribed`.
- `原始文本` should remain raw chat-card content, but standalone share-card author text must not be stored there.
- `作者/来源` should contain the parsed author/source, including standalone Douyin share-card author text.

- 除非用户重新要求，不要恢复 `关键点` 或 `标签` 两个飞书字段。
- 视频分享卡片增强成功时，`标题` 应来自展开后的作品文案，并排除作者信息、发布时间、合集、`识别画面`、`个人观点，仅供参考` 等界面内容。
- 视频记录初次写入时 `摘要` 为空。异步深度处理成功后，`原始文本` 更新为转写全文，`摘要` 更新为基于转写的总结，`处理状态=transcribed`。
- `原始文本` 保持聊天卡片原始内容，但不要写入分享卡片里单独显示的作者名。
- `作者/来源` 写入可解析到的作者或来源，包括抖音分享卡片里单独显示的作者名。

## Documentation / 文档

- User-facing setup and operation live in `README.md`.
- Manual validation lives in `docs/manual-smoke-test.md`.

- 面向用户的安装和运行说明放在 `README.md`。
- 手工验收步骤放在 `docs/manual-smoke-test.md`。
