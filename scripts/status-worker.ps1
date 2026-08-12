[CmdletBinding()]
param([string]$ProjectRoot, [switch]$Json)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$root = if ($ProjectRoot) { $ProjectRoot } elseif ($env:XXSJ_FS_OB_PROJECT_ROOT) { $env:XXSJ_FS_OB_PROJECT_ROOT } else { Split-Path -Parent $PSScriptRoot }
$lockPath = Join-Path $root 'worker.lock'
$statusPath = Join-Path $root 'data\runtime\worker-status.json'
$lock = $null
if (Test-Path -LiteralPath $lockPath) { try { $lock = Get-Content -LiteralPath $lockPath -Raw -Encoding UTF8 | ConvertFrom-Json } catch {} }
$process = if ($lock -and $lock.pid) { Get-CimInstance Win32_Process -Filter "ProcessId=$([int]$lock.pid)" -ErrorAction SilentlyContinue } else { $null }
$alive = [bool]($process -and $process.Name -eq 'node.exe' -and $process.CommandLine -match 'run-auto-worker\.ts')
$status = $null
if (Test-Path -LiteralPath $statusPath) { try { $status = Get-Content -LiteralPath $statusPath -Raw -Encoding UTF8 | ConvertFrom-Json } catch {} }

$state = 'STOPPED'
$exitCode = 2
if ($alive -and -not $status) { $state = 'STATUS UNAVAILABLE'; $exitCode = 5 }
elseif ($alive -and $status.worker_state -eq 'error') { $state = 'ERROR'; $exitCode = 4 }
elseif ($alive) {
    $heartbeatAge = [DateTimeOffset]::UtcNow - [DateTimeOffset]::Parse($status.last_heartbeat_at)
    if ($heartbeatAge.TotalSeconds -ge 60) { $state = 'STALLED'; $exitCode = 3 } else { $state = 'RUNNING'; $exitCode = 0 }
}
$snapshot = [ordered]@{ state=$state; pid=if($alive){[int]$lock.pid}else{$null}; status=$status }
if ($Json) { $snapshot | ConvertTo-Json -Depth 8 -Compress; exit $exitCode }

Write-Host "Worker: $state"
if ($alive) { Write-Host "PID: $($lock.pid)" }
if ($status) {
    $uptime = [DateTimeOffset]::UtcNow - [DateTimeOffset]::Parse($status.started_at)
    $heartbeat = [DateTimeOffset]::UtcNow - [DateTimeOffset]::Parse($status.last_heartbeat_at)
    Write-Host ("Uptime: {0:hh\:mm\:ss}" -f $uptime)
    Write-Host ("Heartbeat: {0}s ago" -f [Math]::Max(0,[int]$heartbeat.TotalSeconds))
    Write-Host ''
    Write-Host 'Queue:'
    Write-Host "  pending: $($status.queue.pending)"
    Write-Host "  processing: $($status.queue.processing)"
    Write-Host "  draft ready: $($status.queue.draft_ready)"
    Write-Host "  failed: $($status.queue.failed)"
    Write-Host "  retry eligible: $($status.queue.retry_eligible)"
    if ($status.current_task) {
        Write-Host ''
        Write-Host "Current: $($status.current_task.platform) | $($status.current_task.title)"
        Write-Host "Stage: [$($status.current_task.stage_index)/$($status.current_task.stage_total)] $($status.current_task.stage)"
    }
}
exit $exitCode
