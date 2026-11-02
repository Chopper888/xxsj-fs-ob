# cleanup-dry-run.ps1 - 任务缓存清理（人工审计入口）
# 保留策略与自动触发共用同一份 TS 规则实现（src/worker/storageCleanup.ts）：
#   done 任务 source.mp4 保留 7 天、stage.json 保留 30 天
#   failed 任务完整目录保留 14 天
#   临时文件（*.tmp*）无条件清理
#   处理中（pending/claimed/media_downloaded/...）或状态未知（无 stage.json）的任务绝不删除
# 本脚本只是调用 TS 通用模块，不做独立判断，避免与自动触发逻辑分叉。
# 默认 DRY-RUN 只读预演；加 -Execute 才真实删除。
param([switch]$Execute)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$tsx = Join-Path $root 'node_modules\.bin\tsx.cmd'

if (-not (Test-Path -LiteralPath $tsx)) {
  Write-Host "错误: 未找到 $tsx，请先在本仓库执行安装（pnpm install）" -ForegroundColor Red
  exit 1
}

Push-Location $root
try {
  if ($Execute) {
    & $tsx scripts/run-storage-cleanup.ts --execute
  } else {
    & $tsx scripts/run-storage-cleanup.ts --dry-run
  }
  exit $LASTEXITCODE
} finally {
  Pop-Location
}
