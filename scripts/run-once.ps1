# run-once.ps1 - 单次自动处理
param([string]$RecordIds)
if (-not $RecordIds) { Write-Error "需要 -RecordIds"; exit 1 }
npx tsx scripts/run-auto-worker.ts --record-ids $RecordIds --max-tasks 1 --run-once
