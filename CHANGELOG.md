# Changelog

## Unreleased (v1.0.1 candidate)

- 修复历史 failed 占满候选名额导致 pending 饥饿的问题，统一 pending、draft_ready、可恢复 failed 的稳定优先级。
- failed 自动重试仅限抖音可恢复错误，最多 3 次，并采用 1/5/15 分钟退避；不支持平台和永久错误不再自动重试。
- 新增原子写入的 Worker 状态快照、心跳、队列与 8 阶段进度。
- 新增 `status-worker.ps1` 与 `monitor-worker.ps1`；启动器在单实例 Worker 启动或复用后自动打开 Monitor。

## v1.0.0

- 完成抖音端到端信息收集
- 飞书机器人与 Base 任务队列
- Qwen-ASR 主转写
- Faster-Whisper Large-v3 fallback
- DeepSeek 分析
- Obsidian 原子写入
- Worker、断点恢复、幂等与冲突保护
- Codex Skill
- CMD/快捷方式启动入口
