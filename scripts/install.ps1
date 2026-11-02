# install.ps1 - 信息收集 Skill 安装脚本
param([switch]$SkipDoctor)
$ErrorActionPreference = "Stop"
Write-Host "=== 信息收集 Skill 安装 ==="

# 1. Check Node.js
try { node --version 2>$null | Out-Null; Write-Host "[OK] Node.js" } catch { Write-Error "需要 Node.js"; exit 1 }

# 2. Install npm dependencies
Write-Host "安装 npm 依赖..."
pnpm install 2>$null
if ($LASTEXITCODE -ne 0) { npm install }
Write-Host "[OK] npm 依赖"

# 3. Check Python
try { python --version 2>$null | Out-Null; Write-Host "[OK] Python" } catch { Write-Host "[WARN] Python 未安装（Large-v3 fallback 需要）" }

# 4. Check FFmpeg
try { ffmpeg -version 2>$null | Out-Null; Write-Host "[OK] FFmpeg" } catch { Write-Host "[WARN] FFmpeg 未安装" }

# 5. Check Faster-Whisper
try { python -c "import faster_whisper" 2>$null; Write-Host "[OK] Faster-Whisper" } catch { Write-Host "[WARN] Faster-Whisper 未安装, 运行: pip install faster-whisper" }

# 6. Create directories
$dirs = @("data\tasks", "data\logs")
foreach ($d in $dirs) { New-Item -ItemType Directory -Force $d | Out-Null }
Write-Host "[OK] 目录结构"

# 7. Config template
if (-not (Test-Path ".env")) {
    Copy-Item ".env.example" ".env"
    Write-Host "[OK] .env 模板已创建，请编辑填入配置"
} else {
    Write-Host "[OK] .env 已存在，跳过"
}

# 8. Doctor
if (-not $SkipDoctor) {
    Write-Host "运行环境检查..."
    .\scripts\doctor.ps1
}

Write-Host "安装完成！"
