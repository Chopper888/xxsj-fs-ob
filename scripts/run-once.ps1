[CmdletBinding()]
param([string]$RecordIds, [int]$MaxTasks = 4)

$root = Split-Path -Parent $PSScriptRoot
$tsxCli = Join-Path $root 'node_modules\tsx\dist\cli.mjs'
$args = @($tsxCli, 'scripts/run-auto-worker.ts', '--run-once', '--max-tasks', [string]$MaxTasks)
if (-not [string]::IsNullOrWhiteSpace($RecordIds)) { $args += @('--record-ids', $RecordIds) }
& node.exe @args
exit $LASTEXITCODE
