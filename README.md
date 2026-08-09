# xxsj-fs-ob

# Douyin Self-Share Capture / 抖音自分享捕获

This project monitors the user's own Douyin web inbox and writes newly shared-to-self items into Feishu Base.

本项目监控用户自己的抖音网页版私信会话，把“转发给自己”的新增内容写入飞书多维表格，作为个人知识库入口。

## What It Does / 功能

- Sender can be iPhone, Android, Douyin web, or Douyin desktop, as long as the message appears in Douyin web inbox.
- The monitor runs from the computer side with Playwright and a persistent browser profile.
- Video share cards are clicked to resolve a Douyin aweme ID. The monitor expands the caption before reading it and excludes author badges, publish times, collections, and other page controls from the title.
- After a video record is written successfully, the monitor enqueues it for internal async deep processing: exact-ID media lookup, audio-stream validation, direct MP4 transcription with Whisper `base`, Traditional-to-Simplified conversion, summary generation, and Feishu update by `去重 ID`.
- Feishu fields written by the MVP are: `标题`, `内容类型`, `原始链接`, `原始文本`, `作者/来源`, `摘要`, `捕获时间`, `处理状态`, `去重 ID`, `错误信息`, `知识库链接`.
- Feishu fields `关键点` and `标签` are not part of the current MVP field contract.

- 发送端可以是 iPhone、Android、抖音网页端或桌面端，只要消息能同步到电脑端抖音网页版私信。
- 监控端使用 Playwright 和持久浏览器用户目录运行在电脑上。
- 视频分享卡片会被点击解析出抖音作品 ID。监控会先展开文案再读取标题，并排除作者徽章、发布时间、合集和其他页面控件。
- 视频记录成功写入后，监控工具会放入内部异步队列：按作品 ID 精确获取媒体、校验音轨、使用 Whisper `base` 直接转写 MP4、繁体转简体、生成摘要，并按 `去重 ID` 回写飞书。
- 当前 MVP 写入飞书的字段是：`标题`、`内容类型`、`原始链接`、`原始文本`、`作者/来源`、`摘要`、`捕获时间`、`处理状态`、`去重 ID`、`错误信息`、`知识库链接`。
- `关键点` 和 `标签` 两个飞书字段不属于当前 MVP 字段契约。

## Field Meaning / 字段含义

- `标题`: for video share cards, this is the expanded video caption including hashtags when available. Author metadata and page controls are excluded.
- `摘要`: video records leave this empty at first; the async worker fills it from the transcript when deep processing succeeds.
- `原始文本`: the raw visible message text from the Douyin chat card, except standalone share-card author text. After video deep processing succeeds, this field is updated with the transcript.
- `作者/来源`: parsed from the first `作者: 内容` or `作者：内容` prefix, or from a standalone Douyin share-card author.
- `原始链接`: the resolved Douyin video URL when enrichment succeeds.

- `标题`：视频分享卡片使用展开后的作品文案，能读到 `#话题` 时包含 `#话题`；不包含用户名、认证徽章、发布时间、合集、`识别画面` 或 `个人观点，仅供参考` 等界面信息。
- `摘要`：视频记录初次写入时留空；异步深度处理成功后，才写入基于转写全文的摘要。
- `原始文本`：抖音聊天卡片里的原始可见文本，但不再放入分享卡片里单独显示的作者名。视频深度处理成功后，这个字段会更新为转写全文。
- `作者/来源`：能识别 `作者: 内容` 或 `作者：内容` 前缀时取作者部分；抖音分享卡片单独显示作者名时也写到这里。
- `原始链接`：卡片增强成功时写入解析出的抖音视频链接。

## Setup / 配置

Prerequisites: Node.js, Corepack, Python 3.10+, FFmpeg (`ffmpeg` and `ffprobe`), and an authenticated `lark-cli` with write access to the target Feishu Base.

前置条件：Node.js、Corepack、Python 3.10+、FFmpeg（同时提供 `ffmpeg` 和 `ffprobe`），以及已完成用户认证且可写入目标多维表格的 `lark-cli`。

```bash
corepack enable
pnpm install
pnpm exec playwright install chromium
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
cp .env.example .env
```

Fill `.env` locally. Do not commit `.env`.

本地填写 `.env`。不要提交 `.env`。

Required values:

必填项：

```dotenv
FEISHU_BASE_TOKEN=
FEISHU_TABLE_ID=
```

Recommended Douyin monitor values:

推荐的抖音监控配置：

```dotenv
DOUYIN_INBOX_URL=https://www.douyin.com
DOUYIN_OPEN_MESSAGE_TEXT=消息
DOUYIN_OPEN_CHAT_TEXT=你的会话名
BROWSER_USER_DATA_DIR=.browser/douyin
HEADLESS=false
DOUYIN_OFFSCREEN=true
VIDEO_DEEP_PROCESSING=true
TRANSCRIBE_MODEL=base
TRANSCRIBE_LANGUAGE=zh
TRANSCRIBE_COMPUTE_TYPE=
```

`TRANSCRIBE_COMPUTE_TYPE` is kept for queue compatibility and is ignored by the OpenAI Whisper backend.

`TRANSCRIBE_COMPUTE_TYPE` 为队列兼容保留，OpenAI Whisper 后端会忽略它。

`HEADLESS=false` is intentional. Pure headless mode can trigger Douyin verification pages. `DOUYIN_OFFSCREEN=true` keeps a real Chromium window but moves/minimizes/hides it so normal mouse use is not interrupted.

`HEADLESS=false` 是有意保留的。纯 headless 容易触发抖音验证页。`DOUYIN_OFFSCREEN=true` 会保留真实 Chromium 窗口，但把窗口移到屏幕外并最小化/隐藏，避免影响日常鼠标操作。

`VIDEO_DEEP_PROCESSING=true` means `pnpm monitor` will process video jobs in the background after the link record is written. Set it to `false` only when debugging the monitor without transcription.

`VIDEO_DEEP_PROCESSING=true` 表示 `pnpm monitor` 会在链接记录写入后后台处理视频任务。只有在调试监控、不想转写时才设为 `false`。

For Agnes AI or another OpenAI-compatible model provider, set `SUMMARY_MODE=openai` and fill either the generic `LLM_*` variables or the Agnes aliases:

如果使用 Agnes AI 或其他 OpenAI-compatible 模型服务，把 `SUMMARY_MODE` 设为 `openai`，再填写通用的 `LLM_*`，或填写 Agnes 别名变量：

```dotenv
SUMMARY_MODE=openai
AGNES_BASE_URL=
AGNES_API_KEY=
AGNES_MODEL=
```

Use the base URL and model name shown in the Agnes API key/model settings page. Do not commit `.env`.

`AGNES_BASE_URL` 和 `AGNES_MODEL` 使用 Agnes API Key/模型设置页展示的地址和模型名。不要提交 `.env`。

## Run / 运行

First login should be done visibly:

首次登录建议可见运行：

```bash
DOUYIN_OFFSCREEN=false pnpm monitor
```

After login state is saved in `.browser/douyin`, use the normal background mode:

登录态保存到 `.browser/douyin` 后，使用后台模式：

```bash
pnpm monitor
```

To manually test browser-mediated Douyin media capture for one URL:

手工测试单条抖音链接的浏览器媒体捕获：

```bash
pnpm probe:media "https://www.douyin.com/jingxuan?modal_id=..."
```

This command saves media from the exact matching Douyin detail response under `data/media/`. If the target resource cannot be verified, it fails instead of downloading unrelated page media. It does not print or persist signed media URLs.

该命令只会把抖音详情接口中与目标作品精确匹配的媒体保存到 `data/media/`。无法核验目标资源时会直接失败，不会下载页面里的其他视频；同时不会打印或持久化签名媒体直链。

To transcribe a local audio or video file with Whisper `base`:

使用 Whisper `base` 转写本地音频或视频文件：

```bash
pnpm transcribe:whisper data/media/aweme_7650000000000000000.mp4 --language zh
```

Whisper may emit Traditional Chinese even when `--language zh` is set. The background worker converts transcripts and generated summaries to Simplified Chinese before writing them to Feishu.

Whisper 即使设置了 `--language zh`，仍可能输出繁体中文。后台处理器会在写入飞书前，把转写全文和生成的摘要统一转换为简体中文。

If you use the desktop launcher, double-click the command file in the project root:

如果使用桌面启动方式，双击项目根目录里的命令文件：

```text
./启动抖音监控.command
```

Keep the terminal window open while monitoring. Press `Ctrl+C` in that window to stop.

监控时保持终端窗口打开。需要停止时在该窗口按 `Ctrl+C`。

## Privacy / 隐私

- `.env`, `.browser/`, `data/`, `logs/`, and `.venv/` are ignored by Git and must remain local. They can contain credentials, login state, downloaded videos, transcripts, and private-message-derived records.
- The monitor does not print or persist signed media URLs, cookies, or request headers.
- `SUMMARY_MODE=mock` does not call an external summary model. With `SUMMARY_MODE=openai`, the title and transcript are sent to the configured OpenAI-compatible provider, such as Agnes AI, to generate the summary.
- Feishu receives only the fields listed in the field contract above.

- `.env`、`.browser/`、`data/`、`logs/`、`.venv/` 已被 Git 忽略，必须只保留在本地；其中可能包含密钥、登录状态、下载视频、转写全文和来源于私信的记录。
- 监控不会打印或持久化签名媒体直链、Cookie 或请求头。
- `SUMMARY_MODE=mock` 不调用外部摘要模型；使用 `SUMMARY_MODE=openai` 时，标题和转写全文会发送给已配置的 OpenAI-compatible 服务（例如 Agnes AI）生成摘要。
- 飞书只接收上文字段契约中列出的字段。

## Verify / 验证

```bash
pnpm test
pnpm typecheck
```

Manual validation steps are in [docs/manual-smoke-test.md](docs/manual-smoke-test.md).

手工验收步骤见 [docs/manual-smoke-test.md](docs/manual-smoke-test.md)。

## 许可证

本项目采用 MIT License。允许使用、复制、修改和二次发布，但须保留原作者版权声明及 LICENSE。

原作者：乔巴