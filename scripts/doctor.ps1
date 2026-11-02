# doctor.ps1 - 环境检查（只提示，不阻止启动）
$root = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $root '.env'
. (Join-Path $PSScriptRoot 'dotenv.ps1')

Write-Host "=== 环境检查 ==="
$ok = 0; $warn = 0; $err = 0

function Check($name, $test) {
    try { & $test 2>$null | Out-Null; Write-Host "[OK] $name"; $script:ok++ }
    catch { Write-Host "[WARN] $name - 未安装或不在 PATH，可能影响部分功能"; $script:warn++ }
}
function CheckEnv($name, $key, [bool]$required = $true) {
    $value = Get-DotEnvValue $envFile $key
    if (-not [string]::IsNullOrWhiteSpace($value) -and $value -notmatch 'REPLACE|_REPLACE_ME|<') {
        Write-Host "[OK] $name 已配置"
        $script:ok++
    } elseif ($required) {
        Write-Host "[WARN] $name 未配置（$key）"
        $script:warn++
    }
}

Check "Node.js" { node --version }
Check "pnpm/npm" { npm --version }
Check "Python" { python --version }
Check "FFmpeg" { ffmpeg -version }
Check "lark-cli" { lark-cli --version }

if (Test-Path -LiteralPath $envFile) {
    Write-Host "[OK] .env 存在"
    $ok++
    CheckEnv "飞书 Base Token" "FEISHU_BASE_TOKEN"
    CheckEnv "飞书 table id" "FEISHU_TABLE_ID"
    CheckEnv "lark-cli profile" "LARK_PROFILE"
    CheckEnv "分析模型 API Key" "LLM_API_KEY"
    CheckEnv "Qwen-ASR Key（可选，缺失时走本地 Whisper）" "DASHSCOPE_API_KEY" $false
} else {
    Write-Host "[ERR] .env 不存在：请复制 .env.example 为 .env 并填写"
    $err++
}

# Obsidian vault：Worker 必需，未配置时启动会直接退出
$vault = Get-DotEnvValue $envFile 'OBSIDIAN_VAULT_PATH'
$inbox = Get-DotEnvValue $envFile 'OBSIDIAN_INBOX_DIR'
if ([string]::IsNullOrWhiteSpace($inbox)) { $inbox = '000-Inbox\001-信息中心' }
if ([string]::IsNullOrWhiteSpace($vault)) {
    Write-Host "[ERR] OBSIDIAN_VAULT_PATH 未配置：请在 .env 填写 Obsidian vault 绝对路径（例如 D:\Obsidian\MyVault）"
    $err++
} elseif (-not (Test-Path -LiteralPath $vault)) {
    Write-Host "[WARN] OBSIDIAN_VAULT_PATH 指向的目录不存在：$vault"
    $warn++
} else {
    $inboxPath = Join-Path $vault $inbox
    if (Test-Path -LiteralPath $inboxPath) { Write-Host "[OK] Obsidian 笔记目录：$inboxPath"; $ok++ }
    else { Write-Host "[WARN] Obsidian 笔记目录不存在（首次运行会自动创建）：$inboxPath"; $warn++ }
}

# 代理：留空表示不使用代理
$httpsProxy = if (-not [string]::IsNullOrWhiteSpace($env:HTTPS_PROXY)) { $env:HTTPS_PROXY } else { Get-DotEnvValue $envFile 'XXSJ_HTTPS_PROXY' }
if ([string]::IsNullOrWhiteSpace($httpsProxy)) { $httpsProxy = Get-DotEnvValue $envFile 'HTTPS_PROXY' }
if ([string]::IsNullOrWhiteSpace($httpsProxy)) {
    Write-Host "[INFO] 未配置代理：抖音/公众号/B站/飞书一般可用；X/YouTube 可能失败"
} else {
    Write-Host "[OK] 代理：$httpsProxy"
    $ok++
}

if (Test-Path -LiteralPath (Join-Path $root 'worker.lock')) { Write-Host "[WARN] worker.lock 存在（可能有残留 Worker）"; $warn++ }
else { Write-Host "[OK] 无 worker.lock"; $ok++ }

Write-Host "=== 结果: $ok 通过, $warn 警告, $err 错误 ==="
