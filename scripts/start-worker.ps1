[CmdletBinding()]
param([string]$RecordIds)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# 代理：优先使用进程环境；否则读 .env 的 XXSJ_HTTPS_PROXY / XXSJ_HTTP_PROXY，再回退 .env 的 HTTPS_PROXY / HTTP_PROXY。
# 都为空 = 不设代理（抖音、公众号、B站、飞书一般无需代理；X、YouTube 通常需要）。
$root = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $root '.env'
. (Join-Path $PSScriptRoot 'dotenv.ps1')
if ([string]::IsNullOrWhiteSpace($env:HTTPS_PROXY)) { $env:HTTPS_PROXY = Get-DotEnvValue $envFile 'XXSJ_HTTPS_PROXY' }
if ([string]::IsNullOrWhiteSpace($env:HTTPS_PROXY)) { $env:HTTPS_PROXY = Get-DotEnvValue $envFile 'HTTPS_PROXY' }
if ([string]::IsNullOrWhiteSpace($env:HTTP_PROXY)) { $env:HTTP_PROXY = Get-DotEnvValue $envFile 'XXSJ_HTTP_PROXY' }
if ([string]::IsNullOrWhiteSpace($env:HTTP_PROXY)) { $env:HTTP_PROXY = Get-DotEnvValue $envFile 'HTTP_PROXY' }
if (-not [string]::IsNullOrWhiteSpace($env:HTTPS_PROXY) -or -not [string]::IsNullOrWhiteSpace($env:HTTP_PROXY)) {
    if ([string]::IsNullOrWhiteSpace($env:NO_PROXY)) { $env:NO_PROXY = 'localhost,127.0.0.1,::1' }
    if ([string]::IsNullOrWhiteSpace($env:NODE_OPTIONS)) { $env:NODE_OPTIONS = '--use-env-proxy' }
    elseif ($env:NODE_OPTIONS -notmatch 'use-env-proxy') { $env:NODE_OPTIONS = "$env:NODE_OPTIONS --use-env-proxy" }
}
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
