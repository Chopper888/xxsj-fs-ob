# Project Agent Guide / 项目 Agent 指南

This file is the project-specific source of truth for AI agents working in this repository.

这是本仓库的项目级 AI 协作规则源文件。

## 项目定位

`xxsj-fs-ob` 是一套运行在用户自己电脑上的信息收集系统，同时提供 Codex Skill 集成。

当前正式实现：抖音视频采集 → 飞书多维表格任务队列 → 本地 Worker → Qwen-ASR → Faster-Whisper Large-v3 fallback → DeepSeek 摘要/分类 → Markdown → Obsidian → Base 回写。

## Scope / 范围

- Project root: this repository root.
- Runtime: TypeScript Node.js CLI, Vitest, pnpm.
- Checks: `pnpm test` and `pnpm typecheck`.
- 主命令：Worker 通过 `scripts/start-worker.ps1` 或 `start-xxsj-fs-ob-worker.cmd` 启动。

## 当前正式支持 (v1.0.0)

- 抖音视频链接采集和处理
- 飞书多维表格任务队列
- Qwen-ASR 主转写
- Faster-Whisper Large-v3 备用转写
- DeepSeek 摘要、分类和值得保存的信息
- Obsidian Markdown 原子写入
- 去重、幂等、断点恢复、锁和冲突保护
- bot identity 无人值守 Base 读写

## 尚未正式实现

- 公众号
- B站
- YouTube
- 推特 / X
- 小红书

目录中存在不等于功能已实现。遇到未支持平台，Worker 会明确拒绝。

## 平台 adapter 扩展原则

当需要添加新平台时：
1. 创建新平台目录（如 `src/platform/bilibili/`）
2. 实现平台 adapter 接口
3. 在 Worker 中注册新平台
4. 仅通过配置启用，不影响已有平台处理链

## 目录结构

```
xxsj-fs-ob/
├── src/              # TypeScript 源代码
│   ├── analysis/     # 内容分析（DeepSeek）
│   ├── asr/          # ASR 转写编排（Qwen + Whisper fallback）
│   ├── base/         # 飞书多维表格适配器
│   ├── media/        # 抖音媒体捕获
│   ├── obsidian/     # Obsidian 写入
│   ├── pipeline/     # 处理管道
│   ├── summary/      # DeepSeek 摘要与分类
│   ├── video/        # 视频深度处理
│   ├── worker/       # 自动 Worker
│   └── config.ts     # 配置管理
├── scripts/          # PowerShell 和 Python 脚本
├── tests/            # Vitest 测试 (25 文件, 229 tests)
├── docs/             # 文档
├── config/           # 配置模板
├── references/       # 架构参考
└── SKILL.md          # Codex Skill 定义
```

## Safety / 安全

- 不要打印或提交 `.env`、飞书 token、LLM API Key、浏览器 Cookie、Playwright 用户目录内容。
- `.env`、`.browser/`、`data/`、`logs/` 是本地运行状态，必须留在 git 外。
- `.env.example` 只能保留空白密钥占位。
- 除非用户明确要求本地调试输出，不要在日志里输出完整私信正文。

## 测试命令

```bash
pnpm test          # 25 测试文件, 229 tests
pnpm test:watch    # watch 模式
pnpm typecheck     # TypeScript 类型检查
```

## 安全规则

- 不读取真实 `.env`
- 不使用真实 Base 数据作 fixture
- 测试使用合成数据
- 不调用真实飞书、Qwen、DeepSeek、Whisper
- 不下载大型模型
- 不写入真实 Obsidian

## 当前抖音正式支持范围

- 飞书机器人接收抖音链接 → Base pending
- Worker 领任务：解析作品 ID → 下载视频 → Qwen-ASR 转写
- ASR 失败自动切 Faster-Whisper Large-v3
- DeepSeek 生成摘要、分类、值得保存的信息
- 生成 Markdown → 写入 Obsidian
- Base 状态回写 done
- 去重（Record ID + 平台作品 ID）
- 幂等（已下载不重复下载、已转写不重复转写）
- 断点恢复
- Obsidian 原子写入（冲突保护、用户修改检测）

## 公众号是下一优先级

公众号内容采集与 Markdown 化是 v1.x 路线的下一个平台目标。
