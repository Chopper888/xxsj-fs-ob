---
name: xxsj-fs-ob
description: "通过飞书多维表格任务队列运行本地信息收集 Worker：从抖音、B站、微信公众号、X、YouTube 采集内容，转写并做 AI 分析，归档到 Obsidian。"
---

# xxsj-fs-ob

适用于 Claude Code 与 Codex。用于安装、检查、启动、停止和排错；正式处理由本地 Worker 完成。

## 适用场景

- 安装或检查 xxsj-fs-ob；
- 启动、停止、查看 Worker 状态；
- 单次处理队列或指定飞书 Record ID；
- 查看失败任务并决定是否重试；
- 排查飞书、ASR、模型分析或 Obsidian 写入问题；
- 清理缓存预演。

## 项目定位

- 项目根目录：包含 `package.json`、`src/`、`scripts/` 的完整源码目录。
- Skill 目录可以只是包装层；Worker 必须从项目根启动。
- 运行根优先级：`-ProjectRoot` → `XXSJ_FS_OB_PROJECT_ROOT` → 启动器所在目录（须是完整项目根）。
- Worker 启动后不依赖 Agent 会话保持在线。

## 平台与写法

`来源平台` 统一写下列标准值：

| 标准写法 | 能力 |
|---|---|
| 抖音 | 视频、图文 `/note/`；文章 `/article/` 未验证；不支持 v.douyin.com 短链 |
| B站 | BV/av、b23.tv 短链、视频转写 |
| 微信公众号 | `/s/` 文章、图片归档 |
| X | status 链接、t.co 短链、纯数字 ID；图片、视频 |
| YouTube | `watch?v=`、`youtu.be`；官方字幕优先，无字幕转音频 ASR |

小红书、其他：未实现，Worker 不会领取。来源平台留空按「抖音」处理。

## 处理流程

```text
飞书机器人收到链接
→ 多维表格新建 pending 记录
→ Worker 领取并锁定
→ 解析、下载（图片/音视频）
→ 官方字幕优先，否则 Qwen-ASR；失败回退 faster-whisper large-v3
→ 模型生成摘要、要点、分类
→ 生成 Markdown
→ 原子写入 Obsidian
→ 回写 处理状态=done 与 知识库路径
```

## 常用命令

```powershell
# 环境检查
.\scripts\doctor.ps1

# 单轮处理（默认最多 4 条，处理完退出）
.\scripts\run-once.ps1

# 指定飞书 Record ID（不是平台作品 ID）
.\scripts\run-once.ps1 -RecordIds "recxxxxxxxx"

# 后台长期 Worker / 单次指定记录
.\scripts\start-worker.ps1
.\scripts\start-worker.ps1 -RecordIds "recxxxxxxxx"

# 状态、监控、停止
.\scripts\status-worker.ps1
.\scripts\monitor-worker.ps1
.\scripts\stop-worker.ps1

# 缓存清理预演（默认只读；-Execute 才删除）
.\scripts\cleanup-dry-run.ps1
```

普通用户也可双击 `start-xxsj-fs-ob-worker.cmd`。重复双击会复用已运行的 Worker。

## 查失败任务（必须先向用户确认）

1. 读取多维表格中 `处理状态=failed` 的记录，汇报 `最近错误`。
2. 说明是否可自动重试：最多 3 次，退避 60/300/900 秒，计数在本地 `stage.json`。
3. **等待用户确认**要重试哪些。
4. 把确认的记录改为 `处理状态=pending`、清空 `最近错误`。
5. 运行 `run-once.ps1` 或等待 Worker 下一轮。

不要擅自重置失败记录。

## 配置

- 复制 `.env.example` 为 `.env`，填入自己的值。
- 必填：`FEISHU_BASE_TOKEN`、`FEISHU_TABLE_ID`、`LARK_PROFILE`、`OBSIDIAN_VAULT_PATH`、`LLM_API_KEY`（`SUMMARY_MODE=openai` 时）。
- 可选：`DASHSCOPE_API_KEY`（不填走本地 Whisper）。
- 代理：`XXSJ_HTTPS_PROXY` / `XXSJ_HTTP_PROXY`，留空表示不使用；X、YouTube 通常需要。
- 完整说明见 `README.md` 与 `.env.example` 注释。

## 安装位置

Skill 目录因客户端而异，不要写死：

- Codex：通常为 `%USERPROFILE%\.codex\skills\xxsj-fs-ob`
- Claude Code：通常为 `%USERPROFILE%\.claude\skills\xxsj-fs-ob`

只保留一份；安装后重启客户端并在 Skill 选择器中确认出现。

## 安全边界

- 不输出或提交 API Key、App Secret、Token、Cookie、Base 标识、本机绝对路径。
- 不打印签名媒体 URL。
- 不覆盖用户修改过的 Obsidian 笔记。
- 不把失败任务标为 done。
- 不同时启动多个 Worker。
- 不把未支持平台伪装成已支持。
