# Changelog

## v1.0.1 - 2026-08-12

### Fixed

- 修复 Windows CMD 启动链的编码与行尾导致启动失败，以及启动入口未进入长期轮询的问题。
- 修复 `stop-worker` 只删除 lock 而未停止进程的问题。
- 修复历史 failed 占满候选名额导致 pending starvation，以及 selector 与 processor 的 failed 状态契约冲突。
- failed 自动 retry 仅处理可恢复错误，最多 3 次并采用 1/5/15 分钟退避；unsupported platform 和 terminal failed 不再无限重试。

### Added

- 新增长期轮询 Worker、原子状态快照、5 秒 heartbeat、`status-worker.ps1` 和 `monitor-worker.ps1`。
- 新增 RUNNING / STALLED / STOPPED / ERROR、队列统计与 8 阶段任务进度。
- 启动快捷方式自动打开 Monitor；Worker 已运行时重复双击仅打开 Monitor，不创建第二实例。

### Quality

- 27/27 test files，251/251 tests。
- TypeScript、PowerShell、validate 和 GitHub CI 通过。

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
