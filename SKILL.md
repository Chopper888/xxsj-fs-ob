---
name: xxsj-fs-ob
description: "通过飞书多维表格任务队列启动和维护本地信息收集 Worker，将抖音视频转写、分析并归档到 Obsidian。"
---

# xxsj-fs-ob

## 适用场景

使用此 Skill 处理以下请求：

- 安装或检查 xxsj-fs-ob；
- 启动、停止或检查信息收集 Worker；
- 处理飞书多维表格中的抖音任务；
- 指定飞书 Base Record ID 进行单次处理；
- 查看 pending、failed 或恢复状态；
- 执行 doctor、包装校验或缓存清理预演；
- 排查飞书、ASR、DeepSeek 或 Obsidian 写入问题。

## 项目定位

这是一个本地信息收集系统的 Codex 操作层。

Codex 用于安装、检查、启动、停止和排错。正式业务处理由本地 Worker 完成。Worker 启动后，不要求 Codex 会话持续在线。

Base 指飞书多维表格。

## 当前正式支持

- 抖音视频采集和处理；
- 飞书多维表格任务队列；
- Qwen-ASR 主转写；
- Faster-Whisper Large-v3 fallback；
- DeepSeek 摘要、分类和值得保存的信息；
- Obsidian Markdown 原子写入；
- 去重、幂等、断点恢复、锁和冲突保护；
- bot identity 无人值守 Base 读写。

## 尚未支持

以下平台仅有目录或架构预留，不能宣称已实现：

- 公众号；
- B站；
- YouTube；
- 推特 / X；
- 小红书。

遇到未支持平台时，不得伪造结果，不得将任务标记为 done。

## 固定处理流程

```text
飞书机器人收到抖音链接
→ 飞书多维表格创建 pending 记录
→ Worker 领取并锁定任务
→ 解析和下载抖音视频
→ Qwen-ASR 转写
→ 失败时使用 Faster-Whisper Large-v3
→ DeepSeek 生成摘要、分类和值得保存的信息
→ 生成 Markdown
→ 原子写入 Obsidian
→ 回写 Base
→ done
```

## 启动原则

普通用户只保留两种启动方式。

### Codex 启动

检查环境和 Worker 状态后，调用现有启动脚本。不得创建第二套 Worker。

### CMD 或快捷方式启动

用户双击：

`start-xxsj-fs-ob-worker.cmd`

调用链：

```text
start-xxsj-fs-ob-worker.cmd
→ start-xxsj-fs-ob-worker.ps1
→ scripts\start-worker.ps1
```

`.ps1` 是底层脚本，不作为第三种普通用户启动方式宣传。

## 常用命令

```powershell
# 包装校验
.\scripts\validate-skill.ps1

# 环境检查
.\scripts\doctor.ps1

# 单次处理
.\scripts\run-once.ps1

# 指定飞书 Base Record ID
.\scripts\run-once.ps1 -RecordIds "recxxxxxxxx"

# 启动 Worker
.\scripts\start-worker.ps1

# 停止 Worker
.\scripts\stop-worker.ps1

# 缓存清理预演
.\scripts\cleanup-dry-run.ps1
```

具体参数以脚本帮助和当前 README 为准。

## 安装目录

不要假定所有 Codex 客户端都使用同一路径。

安装时：

1. 查找当前客户端已能正常显示的 Skill；
2. 使用其真实目录作为参照；
3. 只安装一份 xxsj-fs-ob；
4. 完全重启 Codex；
5. 在 Skill 选择器中确认实际出现。

当前本机实测安装目录为：

`%USERPROFILE%\.codex\skills\xxsj-fs-ob`（请以实际 Codex 客户端发现的目录为准）

公开说明中不得把该用户名路径写成其他用户必须照搬的路径。

## 安全边界

- 不输出或提交 API Key、App Secret、Token、Cookie 或完整 `.env`；
- 不打印或持久化完整签名媒体 URL；
- 不覆盖用户已经修改的 Obsidian 笔记；
- 不处理未授权记录；
- 不将失败任务错误标记为 done；
- 不无限重试；
- 不同时启动多个 Worker；
- 不把未支持平台伪装成已支持；
- 不修改用户自己的飞书应用配置。

## 数据存档

每条已处理内容长期保留：

1. 内部原始 ASR 结果；
2. Obsidian 最终 Markdown。

不恢复人工校订、人工审批或多层逐字稿存档流程。

## 版本

`v1.0.0`