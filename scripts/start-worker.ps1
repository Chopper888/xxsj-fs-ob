[CmdletBinding()]
param([string]$RecordIds)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$lockPath = Join-Path $root 'worker.lock'
$stopPath = Join-Path $root 'worker.stop'
$logDir = Join-Path $root 'logs'
$logPath = Join-Path $logDir 'worker.log'
$errorPath = Join-Path $logDir 'worker.error.log'
$tsxCli = Join-Path $root 'node_modules\tsx\dist\cli.mjs'

if (-not (Test-Path -LiteralPath $tsxCli -PathType Leaf)) { throw "tsx runtime not found: $tsxCli" }
if (Test-Path -LiteralPath $lockPath) {
    $lock = Get-Content -LiteralPath $lockPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $existing = Get-CimInstance Win32_Process -Filter "ProcessId=$([int]$lock.pid)" -ErrorAction SilentlyContinue
    if ($existing -and $existing.Name -eq 'node.exe' -and $existing.CommandLine -match 'run-auto-worker\.ts') {
        Write-Host "Worker already running: PID $($lock.pid)"
        exit 0
    }
    Remove-Item -LiteralPath $lockPath -Force
}
Remove-Item -LiteralPath $stopPath -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $logDir -Force | Out-Null

$args = @($tsxCli, 'scripts/run-auto-worker.ts')
if (-not [string]::IsNullOrWhiteSpace($RecordIds)) { $args += @('--record-ids', $RecordIds, '--run-once') }
$child = Start-Process -FilePath 'node.exe' -ArgumentList $args -WorkingDirectory $root -RedirectStandardOutput $logPath -RedirectStandardError $errorPath -WindowStyle Hidden -PassThru

$deadline = [DateTime]::UtcNow.AddSeconds(15)
do {
    Start-Sleep -Milliseconds 200
    if ($child.HasExited) { throw "Worker exited during startup with code $($child.ExitCode). See $errorPath" }
    if (Test-Path -LiteralPath $lockPath) {
        $lock = Get-Content -LiteralPath $lockPath -Raw -Encoding UTF8 | ConvertFrom-Json
        $worker = Get-CimInstance Win32_Process -Filter "ProcessId=$([int]$lock.pid)" -ErrorAction SilentlyContinue
        if ($worker -and $worker.Name -eq 'node.exe' -and $worker.CommandLine -match 'run-auto-worker\.ts') {
            Write-Host "Worker started: PID $($lock.pid)"
            Write-Host "Log: $logPath"
            exit 0
        }
    }
} while ([DateTime]::UtcNow -lt $deadline)

throw "Worker did not create a valid lock within 15 seconds. PID $($child.Id)"
