# PUBLIC-RELEASE-MANIFEST

## 版本

v1.0.1

## 构建来源

本地正式运行版 (本地正式运行版)

## 构建日期

2026-08-12

## 公共文件统计

- 文件总数: 116
- 目录数: 48

## 包含内容

- 完整业务源码 src/ (17 个子模块)
- 测试 tests/ (27 个测试文件)
- 公共脚本 scripts/ (22 个脚本)
- Skill 包装 SKILL.md
- 文档 docs/ (8 份部署与运维说明)
- 架构参考 references/
- 配置模板 config/
- 根文件: package.json, pnpm-lock.yaml, tsconfig.json, vitest.config.ts, .env.example, .gitignore, README.md, CLAUDE.md
- GitHub 公共文件: CHANGELOG.md, SECURITY.md, CONTRIBUTING.md, LICENSE

## 已排除的私人内容

- .env (真实密钥)
- .git 历史
- node_modules/, .pnpm-store/, .venv/
- data/, logs/, cache/, review/, backup/, tmp/
- PROJECT-HANDOFF.local.md
- 真实视频 (.mp4)
- 真实 ASR 逐字稿
- 真实 Obsidian 笔记
- 真实 Base schema backup JSON
- Codex 执行任务书
- 内部截图与 HTML 记录

## 测试结果

- TypeScript: PASS
- 业务测试: 27/27 test files，251/251 tests
- PowerShell: PASS
- validate-skill.ps1: PASS
- Secret scan: 0 个真实 Secret 命中
- 私人路径 scan: 0 个作者私人绝对路径命中

## 当前支持平台

- 抖音 (正式支持)

## 已知限制

- 公众号、B站、YouTube、推特/X、小红书仅有目录预留
- 需要用户自行配置飞书应用、Base、Qwen、DeepSeek、Obsidian

## LICENSE 当前状态

MIT License
