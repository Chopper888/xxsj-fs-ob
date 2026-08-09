<#
.SYNOPSIS
启动 xxsj-fs-ob 的后台 Worker。

.DESCRIPTION
本脚本不是 Worker 本身，而是一个用户启动入口。
它会定位已经安装的 xxsj-fs-ob Skill，然后调用 Skill 内原有的：
    scripts\start-worker.ps1

Codex 不是运行依赖。安装配置完成后，可以不打开 Codex，直接通过 CMD 或快捷方式调用本脚本。

推荐：把本脚本和 start-xxsj-fs-ob-worker.cmd 放在 Skill 根目录。
自定义路径：
    .\start-xxsj-fs-ob-worker.ps1 -SkillPath "D:\你的目录\xxsj-fs-ob"

启动前运行 doctor：
    .\start-xxsj-fs-ob-worker.ps1 -RunDoctor

当前作者环境示例：
    .\start-xxsj-fs-ob-worker.ps1 `
        -SkillPath "$HOME\.codex\skills\xxsj-fs-ob" `
        -RunDoctor
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory = $false)]
    [string]$SkillPath,

    [Parameter(Mandatory = $false)]
    [switch]$RunDoctor
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Test-XxsjSkillRoot {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    if ([string]::IsNullOrWhiteSpace($Path)) {
        return $false
    }

    $expanded = [Environment]::ExpandEnvironmentVariables($Path)

    return (
        (Test-Path -LiteralPath $expanded -PathType Container) -and
        (Test-Path -LiteralPath (Join-Path $expanded 'SKILL.md') -PathType Leaf) -and
        (Test-Path -LiteralPath (Join-Path $expanded 'scripts\start-worker.ps1') -PathType Leaf)
    )
}

function Resolve-XxsjSkillRoot {
    param(
        [Parameter(Mandatory = $false)]
        [string]$RequestedPath
    )

    $candidates = [System.Collections.Generic.List[string]]::new()

    if (-not [string]::IsNullOrWhiteSpace($RequestedPath)) {
        $candidates.Add($RequestedPath)
    }

    # 当脚本位于 Skill 根目录时，始终优先使用脚本所在目录。
    $candidates.Add($PSScriptRoot)

    # 用户可通过环境变量显式指定安装位置。
    if (-not [string]::IsNullOrWhiteSpace($env:XXSJ_FS_OB_SKILL_PATH)) {
        $candidates.Add($env:XXSJ_FS_OB_SKILL_PATH)
    }

    # 当前作者环境中 Codex 实际读取的用户级目录。
    $candidates.Add((Join-Path $HOME '.codex\skills\xxsj-fs-ob'))

    # 兼容其他 Codex 版本或用户级安装方式。
    $candidates.Add((Join-Path $HOME '.agents\skills\xxsj-fs-ob'))

    foreach ($candidate in $candidates) {
        if ([string]::IsNullOrWhiteSpace($candidate)) {
            continue
        }

        $expanded = [Environment]::ExpandEnvironmentVariables($candidate)

        try {
            $fullPath = [System.IO.Path]::GetFullPath($expanded)
        }
        catch {
            continue
        }

        if (Test-XxsjSkillRoot -Path $fullPath) {
            return $fullPath
        }
    }

    $checked = ($candidates |
        Where-Object { -not [string]::IsNullOrWhiteSpace($_) } |
        Select-Object -Unique) -join "`n  - "

    throw @"
没有找到可运行的 xxsj-fs-ob Skill。

请确认 Skill 已安装，并至少包含：
  - SKILL.md
  - scripts\start-worker.ps1

已检查：
  - $checked

也可以显式指定自己的安装路径：
  .\start-xxsj-fs-ob-worker.ps1 -SkillPath "D:\你的目录\xxsj-fs-ob"
"@
}

$resolvedSkillPath = Resolve-XxsjSkillRoot -RequestedPath $SkillPath
$doctorScript = Join-Path $resolvedSkillPath 'scripts\doctor.ps1'
$startScript = Join-Path $resolvedSkillPath 'scripts\start-worker.ps1'
$stopScript = Join-Path $resolvedSkillPath 'scripts\stop-worker.ps1'

Write-Host ''
Write-Host 'xxsj-fs-ob Worker 启动器'
Write-Host "Skill 路径：$resolvedSkillPath"
Write-Host ''

Push-Location $resolvedSkillPath
try {
    if ($RunDoctor) {
        if (-not (Test-Path -LiteralPath $doctorScript -PathType Leaf)) {
            throw "未找到 doctor 脚本：$doctorScript"
        }

        Write-Host '正在运行环境检查...'
        & $doctorScript

        if (-not $?) {
            throw 'doctor.ps1 执行失败，已停止启动 Worker。'
        }

        Write-Host '环境检查通过。'
        Write-Host ''
    }

    Write-Host '正在调用原有 Worker 启动脚本...'
    & $startScript

    if (-not $?) {
        throw 'start-worker.ps1 执行失败。'
    }
}
finally {
    Pop-Location
}

Write-Host ''
Write-Host 'Worker 启动命令已执行。'
Write-Host '请根据原项目日志或 PID 文件确认 Worker 已进入运行状态。'

if (Test-Path -LiteralPath $stopScript -PathType Leaf) {
    Write-Host '停止 Worker：'
    Write-Host "  & '$stopScript'"
}

Write-Host ''
Write-Host 'Worker 启动后，不需要保持 Codex 会话开启。'
Write-Host '电脑关机或 Worker 被停止后，需要重新启动。'
