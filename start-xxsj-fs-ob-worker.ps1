[CmdletBinding()]
param(
    [string]$ProjectRoot,
    [switch]$RunDoctor,
    [string]$RecordIds
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Test-XxsjProjectRoot {
    param([string]$Path)
    if ([string]::IsNullOrWhiteSpace($Path)) { return $false }
    return (
        (Test-Path -LiteralPath $Path -PathType Container) -and
        (Test-Path -LiteralPath (Join-Path $Path 'package.json') -PathType Leaf) -and
        (Test-Path -LiteralPath (Join-Path $Path 'src') -PathType Container) -and
        (Test-Path -LiteralPath (Join-Path $Path 'scripts\start-worker.ps1') -PathType Leaf)
    )
}

function Resolve-XxsjProjectRoot {
    param([string]$RequestedRoot)
    $candidates = @($RequestedRoot, $env:XXSJ_FS_OB_PROJECT_ROOT, $PSScriptRoot)
    foreach ($candidate in $candidates) {
        if ([string]::IsNullOrWhiteSpace($candidate)) { continue }
        try { $fullPath = [IO.Path]::GetFullPath([Environment]::ExpandEnvironmentVariables($candidate)) }
        catch { continue }
        if (Test-XxsjProjectRoot $fullPath) { return $fullPath }
    }
    throw 'No complete xxsj-fs-ob runtime root found. Set -ProjectRoot or XXSJ_FS_OB_PROJECT_ROOT.'
}

$runtimeRoot = Resolve-XxsjProjectRoot $ProjectRoot
$startScript = Join-Path $runtimeRoot 'scripts\start-worker.ps1'
if ($RunDoctor) {
    $doctorScript = Join-Path $runtimeRoot 'scripts\doctor.ps1'
    if (-not (Test-Path -LiteralPath $doctorScript -PathType Leaf)) { throw "Doctor script not found: $doctorScript" }
    & $doctorScript
    if ($LASTEXITCODE -ne 0) { throw "doctor.ps1 failed with exit code $LASTEXITCODE" }
}

Write-Host "Runtime root: $runtimeRoot"
$arguments = @()
if (-not [string]::IsNullOrWhiteSpace($RecordIds)) { $arguments += @('-RecordIds', $RecordIds) }
& $startScript @arguments
if ($LASTEXITCODE -ne 0) { throw "start-worker.ps1 failed with exit code $LASTEXITCODE" }

$lockPath = Join-Path $runtimeRoot 'worker.lock'
$logPath = Join-Path $runtimeRoot 'logs\worker.log'
$lock = Get-Content -LiteralPath $lockPath -Raw -Encoding UTF8 | ConvertFrom-Json
$process = Get-Process -Id ([int]$lock.pid) -ErrorAction SilentlyContinue
if (-not $process) { throw "Worker process is not alive after launch: PID $($lock.pid)" }
Write-Host "Worker PID: $($lock.pid)"
Write-Host "Worker lock: $lockPath"
Write-Host "Worker log: $logPath"
