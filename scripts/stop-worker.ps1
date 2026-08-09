# stop-worker.ps1 - 停止 Worker（释放锁）
Write-Host "停止 Worker..."
if (Test-Path "worker.lock") {
    $lock = Get-Content "worker.lock" -Raw | ConvertFrom-Json
    Write-Host "  PID: $($lock.pid), Worker: $($lock.workerId)"
    Remove-Item "worker.lock" -Force
    Write-Host "  锁已释放"
} else {
    Write-Host "  无活跃 worker.lock"
}
