[CmdletBinding()]
param([string]$RecordIds, [int]$MaxTasks = 4)

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
$tsxCli = Join-Path $root 'node_modules\tsx\dist\cli.mjs'
$worker = Join-Path $root 'scripts\run-auto-worker.ts'
$args = @($tsxCli, $worker, '--run-once', '--max-tasks', [string]$MaxTasks)
if (-not [string]::IsNullOrWhiteSpace($RecordIds)) { $args += @('--record-ids', $RecordIds) }
Set-Location $root
& node.exe @args
exit $LASTEXITCODE
