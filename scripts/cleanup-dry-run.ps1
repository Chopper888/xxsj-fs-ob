# cleanup-dry-run.ps1 - 缓存清理预演（只读，不删除）
Write-Host "=== 缓存清理预演 (DRY RUN) ==="
$dataDir = "data\tasks"
if (Test-Path $dataDir) {
    $tasks = Get-ChildItem $dataDir -Directory
    foreach ($t in $tasks) {
        $stageFile = Join-Path $t.FullName "stage.json"
        $mediaFile = Join-Path $t.FullName "media\source.mp4"
        $tmpFiles = Get-ChildItem $t.FullName -Recurse -Filter "*.tmp*" -ErrorAction SilentlyContinue
        $stage = if (Test-Path $stageFile) { (Get-Content $stageFile -Raw | ConvertFrom-Json).stage } else { "unknown" }
        Write-Host "  $($t.Name): stage=$stage"
        if ($tmpFiles) { foreach ($f in $tmpFiles) { Write-Host "    [可清理] $($f.Name)" } }
        if ($stage -eq "done" -and (Test-Path $mediaFile)) {
            $age = (Get-Date) - (Get-Item $mediaFile).LastWriteTime
            if ($age.TotalDays -gt 7) { Write-Host "    [可清理] source.mp4 (${age}天前)" }
        }
    }
} else { Write-Host "  无任务缓存" }
Write-Host "=== 仅预演，未实际删除 ==="
