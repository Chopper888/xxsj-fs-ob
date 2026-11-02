# 最终架构

## 核心模块
- `src/worker/autoWorker.ts` - 单实例锁、stage、断点恢复、产物复用
- `src/base/larkCliAdapter.ts` - 飞书 Base lark-cli 适配层
- `src/asr/asrOrchestrator.ts` - Qwen 主路径 + Large-v3 fallback
- `src/analysis/contentAnalysis.ts` - DeepSeek 分析（摘要、关键点、分类）
- `src/obsidian/noteWriter.ts` - Obsidian 原子写入 + 冲突检测
- `scripts/run-auto-worker.ts` - Worker CLI 入口

## 状态机
Base 字段 `处理状态`: pending → processing → done / failed（`draft_ready` 也会被领取）
内部 stage: claimed → media_downloaded → asr_completed → analysis_completed → obsidian_written → done

## 数据流
飞书机器人 → Base record (pending) → Worker 领取 → 下载 → Qwen → DeepSeek → Markdown → Obsidian → Base done
