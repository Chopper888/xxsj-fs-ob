# Contributing

## 开发环境

- Node.js >= 18
- pnpm
- Python >= 3.10 (Faster-Whisper fallback)
- FFmpeg

## 安装依赖

pnpm install
pip install faster-whisper

## 测试

pnpm test
pnpm typecheck

## 注意事项

- 不要提交 .env、Secret、API Key
- 不要使用真实生产 Base 数据作为测试 fixture
- 新平台应通过 adapter 扩展
- 提交前确保 pnpm test 和 pnpm typecheck 通过
