[CmdletBinding()]
param([int]$TimeoutSeconds = 30, [string]$ProjectRoot)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$root = if ($ProjectRoot) { $ProjectRoot } elseif ($env:XXSJ_FS_OB_PROJECT_ROOT) { $env:XXSJ_FS_OB_PROJECT_ROOT } else { Split-Path -Parent $PSScriptRoot }
$lockPath = Join-Path $root 'worker.lock'
$stopPath = Join-Path $root 'worker.stop'
if (-not (Test-Path -LiteralPath $lockPath)) { Write-Host 'Worker is not running.'; exit 0 }

$lock = Get-Content -LiteralPath $lockPath -Raw -Encoding UTF8 | ConvertFrom-Json
$pidValue = [int]$lock.pid
$cim = Get-CimInstance Win32_Process -Filter "ProcessId=$pidValue" -ErrorAction SilentlyContinue
if (-not $cim) { Remove-Item -LiteralPath $lockPath -Force; Write-Host 'Removed stale Worker lock.'; exit 0 }
if ($cim.Name -ne 'node.exe' -or $cim.CommandLine -notmatch 'run-auto-worker\.ts') {
    throw "Refusing to stop PID $pidValue because it is not the xxsj-fs-ob Worker."
}

[IO.File]::WriteAllText($stopPath, 'stop', [Text.UTF8Encoding]::new($false))
$deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
do {
    Start-Sleep -Milliseconds 250
    $alive = Get-Process -Id $pidValue -ErrorAction SilentlyContinue
} while ($alive -and [DateTime]::UtcNow -lt $deadline)

if ($alive) {
    Stop-Process -Id $pidValue
    Wait-Process -Id $pidValue -Timeout 5 -ErrorAction SilentlyContinue
}
if (Get-Process -Id $pidValue -ErrorAction SilentlyContinue) { throw "Worker PID $pidValue did not stop." }
Remove-Item -LiteralPath $lockPath,$stopPath -Force -ErrorAction SilentlyContinue
Write-Host "Worker stopped: PID $pidValue"
