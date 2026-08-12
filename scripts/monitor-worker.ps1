[CmdletBinding()]
param([string]$ProjectRoot, [switch]$Once, [int]$RefreshSeconds = 2)

$ErrorActionPreference = 'Continue'
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$root = if ($ProjectRoot) { $ProjectRoot } elseif ($env:XXSJ_FS_OB_PROJECT_ROOT) { $env:XXSJ_FS_OB_PROJECT_ROOT } else { Split-Path -Parent $PSScriptRoot }
$statusScript = Join-Path $PSScriptRoot 'status-worker.ps1'
$hostExe = if (Get-Command pwsh.exe -ErrorAction SilentlyContinue) { 'pwsh.exe' } else { 'powershell.exe' }

do {
    $raw = & $hostExe -NoLogo -NoProfile -ExecutionPolicy Bypass -File $statusScript -ProjectRoot $root -Json 2>$null
    try { $snapshot = ($raw -join "`n") | ConvertFrom-Json } catch { $snapshot = [pscustomobject]@{state='STATUS UNAVAILABLE';pid=$null;status=$null} }
    if (-not $Once) { Clear-Host }
    Write-Host '============================================'
    Write-Host '        xxsj-fs-ob Worker Monitor'
    Write-Host '============================================'
    Write-Host ''
    Write-Host ("Worker        {0}" -f $snapshot.state)
    Write-Host ("PID           {0}" -f $(if($snapshot.pid){$snapshot.pid}else{'-'}))
    if ($snapshot.status) {
        $uptime=[DateTimeOffset]::UtcNow-[DateTimeOffset]::Parse($snapshot.status.started_at)
        $heartbeat=[DateTimeOffset]::UtcNow-[DateTimeOffset]::Parse($snapshot.status.last_heartbeat_at)
        Write-Host ("Uptime        {0:hh\:mm\:ss}" -f $uptime)
        Write-Host ("Heartbeat     {0}s ago" -f [Math]::Max(0,[int]$heartbeat.TotalSeconds))
        Write-Host ''
        Write-Host 'Queue'
        Write-Host ("Pending       {0}" -f $snapshot.status.queue.pending)
        Write-Host ("Processing    {0}" -f $snapshot.status.queue.processing)
        Write-Host ("Draft Ready   {0}" -f $snapshot.status.queue.draft_ready)
        Write-Host ("Failed        {0}" -f $snapshot.status.queue.failed)
        Write-Host ("Retry Ready   {0}" -f $snapshot.status.queue.retry_eligible)
        Write-Host ''
        if ($snapshot.status.current_task) {
            Write-Host 'Current Task'
            Write-Host ("Platform      {0}" -f $snapshot.status.current_task.platform)
            Write-Host ("Title         {0}" -f $snapshot.status.current_task.title)
            Write-Host ("Progress      [{0}/8] {1}" -f $snapshot.status.current_task.stage_index,$snapshot.status.current_task.stage)
        } else { Write-Host 'Current Task  None' }
        Write-Host ''
        if ($snapshot.status.last_completed) { Write-Host ("Last Done     {0}" -f $snapshot.status.last_completed.title) } else { Write-Host 'Last Done     None' }
        if ($snapshot.status.last_error) { Write-Host ("Last Error    {0}" -f $snapshot.status.last_error.message) } else { Write-Host 'Last Error    None' }
    }
    Write-Host ''
    Write-Host 'Closing this monitor does NOT stop Worker.'
    if (-not $Once) { Start-Sleep -Seconds ([Math]::Max(1,$RefreshSeconds)) }
} while (-not $Once)
