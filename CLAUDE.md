# Project Agent Guide / 项目 Agent 指南

本文件是仓库内 AI 协作规则的事实来源，面向 Claude Code、Codex 等 Agent。

## 范围

- 项目根目录：本仓库根目录。
- 运行时：Windows + TypeScript/Node.js + Playwright + Vitest。
- 主命令：`tsx scripts/run-auto-worker.ts`（轮询飞书多维表格队列）。
- 检查命令：`pnpm typecheck`、`pnpm test`。
- 用户文档：`README.md`、`docs/`。

## 安全

- 不要打印或提交 `.env`、飞书 Token、LLM API Key、浏览器 Cookie、Playwright 用户目录内容。
- `.env`、`.browser/`、`data/`、`logs/`、`cookies/` 是本地运行状态，必须留在 git 外。
- `.env.example` 只能放占位符。
- 除非用户明确要求本地调试，不要在日志里输出完整正文。

## 飞书字段契约（当前 16 个字段）

Worker 只写入以下 4 个字段：

```text
处理状态
知识库路径
处理时间
最近错误
```

其余字段由上游（Hermes/人工）维护，Worker 只读：

```text
收录日期
作品发布日期
原文链接
标题
备注
概述
二级标签
作者
去重ID
来源平台
三级标签
一级标签
```

- 字段白名单在 `src/worker/autoWorker.ts` 的 `BASE_FIELD_NAMES`；表结构变化时必须同步。
- `处理状态` 取值：`pending` / `processing` / `draft_ready` / `done` / `failed`。
- `来源平台` 仅支持：`抖音`、`B站`、`微信公众号`（别名 `公众号`）、`X`（别名 `Twitter`/`推特`）、`YouTube`（别名 `Youtube`/`油管`）。留空按 `抖音` 处理。
- 重试次数保存在本地 `data/tasks/<recordId>/stage.json` 的 `retryCount`，不写飞书。

## 平台能力

| 平台 | 能力 |
|---|---|
| 抖音 | 视频、图文（`/note/`）；文章（`/article/`）代码支持但无真实样本；不支持 v.douyin.com 短链 |
| B站 | BV/av 链接、b23.tv 短链、视频下载 + ASR |
| 微信公众号 | `/s/` 参数型与路径型文章；图片归档 |
| X（推特） | status 链接、t.co 短链、纯数字 ID；图片、视频 |
| YouTube | `watch?v=`、`youtu.be`；官方字幕优先，无字幕转音频 ASR |

小红书未实现。

## 转写

- 主编排：`src/asr/asrOrchestrator.ts`。
- 优先 Qwen-ASR（`DASHSCOPE_API_KEY`），失败回退本地 faster-whisper large-v3。
- 本地脚本：`scripts/transcribe-faster-whisper.py`。
- 相关配置：`ASR_MODE`、`WHISPER_MODEL`、`WHISPER_DEVICE`、`WHISPER_COMPUTE_TYPE`、`TRANSCRIBE_PYTHON_PATH`。
- 无 GPU 时把 `WHISPER_DEVICE=cpu`、`WHISPER_COMPUTE_TYPE=int8`（未实测，需自行验证）。

## Obsidian

- vault 路径来自 `.env` 的 `OBSIDIAN_VAULT_PATH`，未配置时 Worker 启动即退出。
- 收件箱目录来自 `OBSIDIAN_INBOX_DIR`，默认 `000-Inbox\001-信息中心`。
- 平台子目录由 `OBSIDIAN_PLATFORM_DIR_MAP` 映射。
- 原子写入，SHA-256 相同则跳过；用户修改过内容则不覆盖。
- 图片归档到 `<平台>/_assets/<sha256(dedupeKey) 前 16 位>/`。

## 抖音采集规则

- 登录态由 `scripts/manual-login.ts` 保存到 `BROWSER_USER_DATA_DIR`（默认 `.browser/douyin`）。
- 媒体捕获在 `src/media/douyinMediaCapture.ts`；不得打印签名媒体直链、请求头、Cookie。
- 必须使用精确匹配的详情响应，失败时直接报错，不用页面媒体兜底。
- 限流：`src/media/douyinRateLimiter.ts`，120 次/小时，超限延后到下一轮。
- 下载后必须校验存在音轨。

## 代理

- 启动脚本依次读取：进程环境 → `.env` 的 `XXSJ_HTTPS_PROXY`/`XXSJ_HTTP_PROXY` → `.env` 的 `HTTPS_PROXY`/`HTTP_PROXY`。
- 都为空表示不设代理。
- 抖音、公众号、B站、飞书一般不需要代理；X、YouTube 通常需要。

## 验证

```powershell
pnpm typecheck
pnpm test
.\scripts\doctor.ps1
```
