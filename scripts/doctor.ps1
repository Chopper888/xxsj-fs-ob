# doctor.ps1 - 环境检查
Write-Host "=== 环境检查 ==="
$ok = 0; $warn = 0; $err = 0

function Check($name, $test) {
    try { & $test 2>$null | Out-Null; Write-Host "[OK] $name"; $script:ok++ }
    catch { Write-Host "[WARN] $name - 可能影响部分功能"; $script:warn++ }
}
function CheckEnv($name, $key) {
    $v = [Environment]::GetEnvironmentVariable($key)
    if ($v) { Write-Host "[OK] $name 已配置"; $script:ok++ }
    else { Write-Host "[WARN] $name 未配置"; $script:warn++ }
}

Check "Node.js" { node --version }
Check "pnpm/npm" { npm --version }
Check "Python" { python --version }
Check "FFmpeg" { ffmpeg -version }
Check "lark-cli" { lark-cli --version }

# Check .env
if (Test-Path ".env") {
    Write-Host "[OK] .env 存在"
    $envContent = Get-Content ".env" -Raw
    if ($envContent -match "DASHSCOPE_API_KEY=sk-") { Write-Host "[OK] Qwen API Key"; $ok++ }
    else { Write-Host "[WARN] Qwen API Key 未配置"; $warn++ }
    if ($envContent -match "LLM_API_KEY=sk-") { Write-Host "[OK] DeepSeek API Key"; $ok++ }
    else { Write-Host "[WARN] DeepSeek API Key 未配置"; $warn++ }
} else { Write-Host "[ERR] .env 不存在，运行 install.ps1"; $err++ }

# Check Obsidian Vault
$vault = $env:OBSIDIAN_VAULT_PATH
if (Test-Path $vault) { Write-Host "[OK] Obsidian Vault: $vault"; $ok++ }
else { Write-Host "[WARN] Obsidian Vault 不存在: $vault"; $warn++ }

# Check worker lock
if (Test-Path "worker.lock") { Write-Host "[WARN] worker.lock 存在（可能有残留 Worker）"; $warn++ }
else { Write-Host "[OK] 无 worker.lock"; $ok++ }

Write-Host "=== 结果: $ok 通过, $warn 警告, $err 错误 ==="
