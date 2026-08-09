# PUBLIC-RELEASE-MANIFEST

## 版本

v1.0.0

## 构建来源

本地正式运行版 (本地正式运行版)

## 构建日期

2026-08-09

## 公共文件统计

- 文件总数: 102
- 目录数: 38

## 包含内容

- 完整业务源码 src/ (17 个子模块)
- 测试 tests/ (25 个测试文件)
- 公共脚本 scripts/ (20 个脚本)
- Skill 包装 SKILL.md
- 文档 docs/ (8 份部署与运维说明)
- 架构参考 references/
- 配置模板 config/
- 根文件: package.json, pnpm-lock.yaml, tsconfig.json, vitest.config.ts, .env.example, .gitignore, README.md, CLAUDE.md
- GitHub 公共文件: CHANGELOG.md, SECURITY.md, CONTRIBUTING.md, LICENSE-TODO.md

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

- TypeScript: 待用户在新环境中执行 pnpm typecheck
- 业务测试: 待用户在新环境中执行 pnpm test
- validate-skill.ps1: 待验证
- Secret scan: 0 个真实 Secret 命中
- 私人路径 scan: 0 个作者私人绝对路径命中

## 当前支持平台

- 抖音 (正式支持)

## 已知限制

- 公众号、B站、YouTube、推特/X、小红书仅有目录预留
- 需要用户自行配置飞书应用、Base、Qwen、DeepSeek、Obsidian

## LICENSE 当前状态

等待用户选择 (见 LICENSE-TODO.md)

## GitHub 正式 push 前需确认的事项

1. 选择 LICENSE 并替换 LICENSE-TODO.md
2. 本地完整运行 pnpm typecheck + pnpm test 通过
3. 运行 scripts/validate-skill.ps1 通过
4. 确认 GitHub 仓库名称和远程地址
5. 确认 README 中的安装路径与自身环境匹配
6. 确认 .env.example 包含所有必需变量