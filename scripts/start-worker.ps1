# start-worker.ps1 - 启动受控 Worker
param(
    [string]$RecordIds,
    [int]$MaxTasks = 4,
    [int]$IdleTimeoutSeconds = 180
)
if (-not $RecordIds) { Write-Error "需要 -RecordIds"; exit 1 }
npx tsx scripts/run-auto-worker.ts --record-ids $RecordIds --max-tasks $MaxTasks --idle-timeout-seconds $IdleTimeoutSeconds
