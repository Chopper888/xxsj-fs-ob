# Base 记录状态变化示例

以下展示同一条抖音视频任务在 Base 中的完整生命周期。所有数据均为合成示例。

## 阶段 1：pending

Worker 尚未领取。

| 字段 | 值 |
|---|---|
| 处理状态 | pending |
| 原始链接 | https://www.douyin.com/video/7123456789012345678 |
| 标题 | (空) |
| 原始文本 | (空) |
| 摘要 | (空) |
| 错误信息 | (空) |

## 阶段 2：processing

Worker 已领取，正在解析和下载。

| 字段 | 值 |
|---|---|
| 处理状态 | processing |
| 原始链接 | https://www.douyin.com/video/7123456789012345678 |
| 平台作品 ID | 7123456789012345678 |
| 标题 | AI 如何改变内容创作流程 #AI #内容创作 |
| 作者/来源 | 示例创作者 |

## 阶段 3：draft_ready

ASR 转写完成，DeepSeek 分析完成，Markdown 已生成。

| 字段 | 值 |
|---|---|
| 处理状态 | draft_ready |
| 原始文本 | [完整视频逐字稿内容...] |
| 摘要 | 本视频讨论了 AI 在内容创作领域的应用... |

## 阶段 4：done

Obsidian 写入成功，Base 回写完成。

| 字段 | 值 |
|---|---|
| 处理状态 | done |
| 知识库链接 | 000-Inbox/001-信息中心/抖音/AI 如何改变内容创作流程 - 7123456789012345678.md |
| 完成时间 | 2026-08-01 10:05:00 |

## 阶段 X：failed

| 字段 | 值 |
|---|---|
| 处理状态 | failed |
| 错误信息 | Video download failed after 3 retries: Network timeout |
