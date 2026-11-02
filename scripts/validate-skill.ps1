<#
.SYNOPSIS
    Comprehensive xxsj-fs-ob Skill wrapper validation.
.DESCRIPTION
    Checks SKILL.md front matter, document encoding, U+FFFD, old names,
    secrets, duplicates, shortcut, startup files, and cross-location sync.
#>
[CmdletBinding()]
param(
    [string]$SkillPath = "",
    [string]$PeerPath = "",
    [string]$ShortcutPath = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Continue'

if ([string]::IsNullOrWhiteSpace($SkillPath)) {
    $SkillPath = Split-Path -Parent $PSScriptRoot
}
$SkillPath = [System.IO.Path]::GetFullPath([Environment]::ExpandEnvironmentVariables($SkillPath))

Write-Host ""
Write-Host "=== xxsj-fs-ob Skill Wrapper Validation ==="
Write-Host "Checking: $SkillPath"
if ($PeerPath) { Write-Host "Peer:     $PeerPath" }
if ($ShortcutPath) { Write-Host "Shortcut: $ShortcutPath" }
Write-Host ""

$pass = 0; $fail = 0; $warn = 0

function Pass { param($msg) Write-Host "  [PASS] $msg"; $script:pass++ }
function Fail { param($msg) Write-Host "  [FAIL] $msg"; $script:fail++ }
function Warn { param($msg) Write-Host "  [WARN] $msg"; $script:warn++ }

# ===== 10.1 SKILL PACKAGING =====

$skillMd = Join-Path $SkillPath "SKILL.md"
if (-not (Test-Path -LiteralPath $skillMd -PathType Leaf)) {
    Fail "SKILL.md not found: $skillMd"
    Write-Host ""; Write-Host "=== Result: $pass passed, $fail failed, $warn warnings ==="; exit 1
}
Pass "SKILL.md exists"

# Check filename is not SKILL.md.txt
$nameOnly = [System.IO.Path]::GetFileName($skillMd)
if ($nameOnly -eq "SKILL.md") { Pass "Filename is SKILL.md" }
else { Fail "Filename is '$nameOnly', not SKILL.md" }

# Check no BOM
$bytes = [System.IO.File]::ReadAllBytes($skillMd)
$hasBom = ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF)
if ($hasBom) { Fail "SKILL.md has UTF-8 BOM (must be no BOM)" }
else { Pass "SKILL.md has no UTF-8 BOM" }

# Check starts with ---
$content = [System.IO.File]::ReadAllText($skillMd, [System.Text.UTF8Encoding]::new($false))
if ($content.StartsWith("---")) { Pass "SKILL.md starts with ---" }
else { Fail "SKILL.md does not start with --- (first char: '$($content[0])')" }

# Parse YAML front matter more robustly
$fmName = $null; $fmDesc = $null; $fmValid = $false
# Match opening --- (possibly followed by newline), content, closing ---
if ($content -match "(?s)^---\s*\r?\n(.*?)\r?\n---") {
    $yamlBlock = $Matches[1]
    $lines = $yamlBlock -split "\r?\n"
    foreach ($line in $lines) {
        if ($line -match '^\s*name\s*:\s*(.+)$') {
            $raw = $Matches[1].Trim()
            $fmName = $raw -replace '^["'']|["'']$',''  # strip optional quotes
        }
        if ($line -match '^\s*description\s*:\s*(.+)$') {
            $raw = $Matches[1].Trim()
            $fmDesc = $raw -replace '^["'']|["'']$',''
        }
    }
    if ($fmName) { $fmValid = $true }
}
if ($fmValid) { Pass "YAML front matter parseable" }
else { Fail "YAML front matter not parseable" }

if ($fmName -eq 'xxsj-fs-ob') { Pass "name: xxsj-fs-ob" }
else { Fail "name is not 'xxsj-fs-ob', actual: '$fmName'" }

if ($fmDesc -and $fmDesc.Length -gt 0) { Pass "description non-empty ($($fmDesc.Length) chars)" }
else { Fail "description is empty" }

# Check for U+FFFD in SKILL.md
$fffd = [char]0xFFFD
$fffdCount = 0
for ($i = 0; $i -lt $content.Length; $i++) { if ($content[$i] -eq $fffd) { $fffdCount++ } }
if ($fffdCount -gt 0) { Fail "SKILL.md contains $fffdCount U+FFFD replacement characters" }
else { Pass "SKILL.md has no U+FFFD" }

# ===== 10.2 DOCUMENT SCANNING =====

$docsToScan = @("README.md", "SKILL.md")
$docsDir = Join-Path $SkillPath "docs"
if (Test-Path $docsDir) {
    Get-ChildItem -LiteralPath $docsDir -Filter "*.md" -File | ForEach-Object { $docsToScan += "docs\$($_.Name)" }
}

$oldNames = @("information-collector", "information-collector-skill")
foreach ($doc in $docsToScan) {
    $docPath = Join-Path $SkillPath $doc
    if (-not (Test-Path -LiteralPath $docPath)) { continue }
    
    $docBytes = [System.IO.File]::ReadAllBytes($docPath)
    $docBom = ($docBytes.Length -ge 3 -and $docBytes[0] -eq 0xEF -and $docBytes[1] -eq 0xBB -and $docBytes[2] -eq 0xBF)
    $docContent = if ($docBom) {
        [System.Text.Encoding]::UTF8.GetString($docBytes, 3, $docBytes.Length - 3)
    } else {
        [System.Text.Encoding]::UTF8.GetString($docBytes)
    }
    
    # U+FFFD
    $dc = 0
    for ($i = 0; $i -lt $docContent.Length; $i++) { if ($docContent[$i] -eq $fffd) { $dc++ } }
    if ($dc -gt 0) { if ($doc -match '(README|SKILL|安装部署|运行与停止|部署说明)') { Fail "$doc contains $dc U+FFFD" } else { Warn "$doc contains $dc U+FFFD (not in rebuild scope)" } }
    else { Pass "${doc}: 0 U+FFFD" }
    
    # Old names as current name (check H1)
    foreach ($on in $oldNames) {
        if ($docContent -match "(?m)^#\s+.*$on") {
            Fail "$doc uses old name '$on' in heading"
        }
    }
    
    # .agents\skills as sole current path (not as compatibility mention)
    $agentsAsPrimary = ($docContent -match "(?i)当前.*安装.*agents\\skills") -or 
                        ($docContent -match "(?i)正式.*目录.*agents\\skills") -or
                        ($docContent -match "(?i)本机.*路径.*agents\\skills")
    # Exclude compatibility mentions where both paths are listed
    if ($agentsAsPrimary) { Fail "$doc uses .agents\\skills as current primary path" }
}

# README heading check
$readmePath = Join-Path $SkillPath "README.md"
if (Test-Path $readmePath) {
    $rm = [System.IO.File]::ReadAllText($readmePath, [System.Text.UTF8Encoding]::new(([System.IO.File]::ReadAllBytes($readmePath)[0..2] -join '') -eq '239187191'))
    if ($rm -match "(?m)^#\s+xxsj-fs-ob") { Pass "README heading contains xxsj-fs-ob" }
    else { Fail "README heading missing xxsj-fs-ob" }
}

# ===== 10.3 REQUIRED FILES =====

$required = @(
    "scripts\install.ps1", "scripts\doctor.ps1", "scripts\run-once.ps1",
    "scripts\start-worker.ps1", "scripts\stop-worker.ps1",
    "scripts\status-worker.ps1", "scripts\monitor-worker.ps1",
    "start-xxsj-fs-ob-worker.ps1", "start-xxsj-fs-ob-worker.cmd",
    "docs\安装部署与日常使用说明.md", "docs\运行与停止.md", "docs\部署说明.md"
)
foreach ($r in $required) {
    $rp = Join-Path $SkillPath $r
    if (Test-Path -LiteralPath $rp -PathType Leaf) { Pass "Exists: $r" }
    else { Fail "Missing: $r" }
}

# ===== 10.4 DUPLICATE SKILL =====

$isCodex = $SkillPath -match '\.codex\\skills'
$isAgents = $SkillPath -match '\.agents\\skills'
$isRelease = $SkillPath -match '\\release\\'

$codexPath = Join-Path $HOME ".codex\skills\xxsj-fs-ob"
$agentsPath = Join-Path $HOME ".agents\skills\xxsj-fs-ob"
$codexExists = Test-Path -LiteralPath $codexPath -PathType Container
$agentsExists = Test-Path -LiteralPath $agentsPath -PathType Container

if ($isCodex) {
    if ($agentsExists) { Fail "Duplicate: .agents\\skills\\xxsj-fs-ob exists alongside .codex\\skills" }
    else { Pass "No duplicate in .agents\\skills" }
} elseif ($isAgents) {
    if ($codexExists) { Fail "Duplicate: .codex\\skills\\xxsj-fs-ob exists alongside .agents\\skills" }
    else { Pass "No duplicate in .codex\\skills" }
} elseif ($isRelease) {
    if ($codexExists -and $agentsExists) { Fail "Duplicate: both .codex and .agents have xxsj-fs-ob" }
    elseif ($codexExists -and -not $agentsExists) { Pass "Single install: .codex\\skills only" }
    elseif (-not $codexExists -and $agentsExists) { Pass "Single install: .agents\\skills only" }
    else { Warn "No user-level Skill install found (release-only is OK)" }
} else {
    if ($codexExists -and $agentsExists) { Fail "Duplicate: both locations exist" }
    elseif ($codexExists -or $agentsExists) { Pass "Single install detected" }
    else { Warn "No user-level install detected" }
}

# ===== 10.5 SECRET CHECK =====

$envExample = Join-Path $SkillPath ".env.example"
if (Test-Path -LiteralPath $envExample -PathType Leaf) {
    $envText = Get-Content $envExample -Raw -ErrorAction SilentlyContinue
    $secretKeys = @("APP_SECRET", "API_KEY", "TOKEN", "COOKIE", "AUTHORIZATION")
    $skipValues = @("<YOUR_", "your_", "example", "changeme", '${ENV_VAR}', "REPLACE_WITH", "")
    $found = $false
    foreach ($key in $secretKeys) {
        if ($envText -match "(?im)^\s*${key}\s*=\s*(.+)$") {
            $val = $Matches[1].Trim()
            $isPlaceholder = $false
            foreach ($sv in $skipValues) { if ($val -like "*$sv*") { $isPlaceholder = $true; break } }
            if (-not $isPlaceholder -and $val.Length -gt 3) {
                Fail "Secret found: $key = ... (non-placeholder)"
                $found = $true
            }
        }
    }
    if (-not $found) { Pass "No real secrets in .env.example" }
}

# Also scan current docs for secrets
$secretPat = '(?i)(sk-[A-Za-z0-9]{20,}|app_secret\s*=\s*[A-Za-z0-9+\/=]{8,}|bearer\s+[A-Za-z0-9\-_\.]{15,})'
$hasDocSecret = $false
foreach ($doc in @("README.md","SKILL.md")) {
    $dp = Join-Path $SkillPath $doc
    if (Test-Path $dp) {
        $dt = Get-Content $dp -Raw -ErrorAction SilentlyContinue
        if ($dt -match $secretPat) { $hasDocSecret = $true; Fail "Secret pattern in $doc" }
    }
}
if (-not $hasDocSecret) { Pass "No secrets in README/SKILL" }

# ===== 10.6 STARTUP FILES =====

# CMD
$cmdPath = Join-Path $SkillPath "start-xxsj-fs-ob-worker.cmd"
if (Test-Path $cmdPath) {
    $cmdBytes = [System.IO.File]::ReadAllBytes($cmdPath)
    $cmdBom = ($cmdBytes.Length -ge 3 -and $cmdBytes[0] -eq 0xEF -and $cmdBytes[1] -eq 0xBB -and $cmdBytes[2] -eq 0xBF)
    if ($cmdBom) { Fail "CMD has UTF-8 BOM" } else { Pass "CMD has no BOM" }
    
    $cmdText = [System.IO.File]::ReadAllText($cmdPath, [System.Text.UTF8Encoding]::new($false))
    if ($cmdText -match '^\s*@echo off') { Pass "CMD starts with @echo off" }
    else { Fail "CMD does not start with @echo off" }
    
    $nonAscii = @($cmdBytes | Where-Object { $_ -gt 0x7F }).Count
    if ($nonAscii -eq 0) { Pass "CMD is ASCII-only" }
    else { Fail "CMD contains $nonAscii non-ASCII bytes" }

    $crlfCount = ([regex]::Matches($cmdText, "`r`n")).Count
    $bareLfCount = ([regex]::Matches($cmdText, "(?<!`r)`n")).Count
    if ($crlfCount -gt 0 -and $bareLfCount -eq 0) { Pass "CMD uses CRLF line endings" }
    else { Fail "CMD line endings are not CRLF-only" }

    if ($cmdText -notmatch '(?im)^\s*chcp\s') { Pass "CMD does not depend on chcp" }
    else { Fail "CMD must not depend on chcp" }
    
    if ($cmdText -match '%~dp0start-xxsj-fs-ob-worker\.ps1') { Pass "CMD uses %~dp0 for PS1" }
    else { Fail "CMD missing %~dp0 reference to PS1" }
    
    # No hardcoded agents/codex path
    if ($cmdText -match 'C:\\Users\\.*?\\\.(agents|codex)\\skills') { Fail "CMD has hardcoded user skill path" }
    else { Pass "CMD has no hardcoded skill path" }
}

# PS1
$ps1Path = Join-Path $SkillPath "start-xxsj-fs-ob-worker.ps1"
if (Test-Path $ps1Path) {
    $ps1Text = Get-Content $ps1Path -Raw -ErrorAction SilentlyContinue
    
    if ($ps1Text -match '\$PSScriptRoot') { Pass "PS1 uses `$PSScriptRoot" }
    else { Warn "PS1 missing `$PSScriptRoot reference" }
    
    # .codex before .agents in candidates
    $codexIdx = $ps1Text.IndexOf('.codex\skills\xxsj-fs-ob')
    $agentsIdx = $ps1Text.IndexOf('.agents\skills\xxsj-fs-ob')
    if ($codexIdx -ge 0 -and $agentsIdx -ge 0 -and $codexIdx -lt $agentsIdx) {
        Pass "PS1: .codex candidate before .agents"
    } elseif ($codexIdx -ge 0) {
        Pass "PS1 has .codex candidate"
    }
    
    if ($ps1Text -match 'scripts\\start-worker\.ps1') { Pass "PS1 calls scripts\\start-worker.ps1" }
    else { Fail "PS1 missing call to scripts\\start-worker.ps1" }
    
    # No second Worker implementation
    if (($ps1Text | Select-String -Pattern 'function\s+Start-Worker' | Measure-Object).Count -gt 0) {
        Fail "PS1 contains second Worker implementation"
    } else { Pass "PS1 delegates to start-worker.ps1 (no duplicate Worker)" }
}

# ===== 10.7 SHORTCUT =====

if ($ShortcutPath -and (Test-Path -LiteralPath $ShortcutPath -PathType Leaf)) {
    try {
        $sh = New-Object -ComObject WScript.Shell
        $lnk = $sh.CreateShortcut($ShortcutPath)
        $expectedTarget = Join-Path $SkillPath "start-xxsj-fs-ob-worker.cmd"
        
        if ($lnk.TargetPath -eq $expectedTarget) { Pass "Shortcut TargetPath matches SkillPath" }
        else { Fail "Shortcut TargetPath mismatch: $($lnk.TargetPath) vs $expectedTarget" }
        
        if ($lnk.WorkingDirectory -eq $SkillPath) { Pass "Shortcut WorkingDirectory matches SkillPath" }
        else { Fail "Shortcut WorkingDirectory mismatch: $($lnk.WorkingDirectory) vs $SkillPath" }
        
        if ([string]::IsNullOrWhiteSpace($lnk.Description)) { Warn "Shortcut description is empty" }
        else { Pass "Shortcut description: $($lnk.Description)" }
        
        if ($lnk.Arguments) { Warn "Shortcut has arguments: $($lnk.Arguments)" }
        else { Pass "Shortcut has no arguments" }
    } catch { Fail "Cannot read shortcut: $_" }
} elseif ($ShortcutPath) {
    Warn "Shortcut not found: $ShortcutPath"
}

# ===== 10.8 PEER SYNC =====

if ($PeerPath) {
    $peerPath = [System.IO.Path]::GetFullPath([Environment]::ExpandEnvironmentVariables($PeerPath))
    if (Test-Path $peerPath) {
        Write-Host ""
        Write-Host "--- Peer SHA-256 Comparison ($peerPath) ---"
        $syncFiles = @("README.md","SKILL.md","docs\安装部署与日常使用说明.md","docs\运行与停止.md",
                        "docs\部署说明.md","scripts\validate-skill.ps1","start-xxsj-fs-ob-worker.cmd",
                        "start-xxsj-fs-ob-worker.ps1")
        $allMatch = $true
        foreach ($sf in $syncFiles) {
            $a = Join-Path $SkillPath $sf
            $b = Join-Path $peerPath $sf
            $aExist = Test-Path -LiteralPath $a -PathType Leaf
            $bExist = Test-Path -LiteralPath $b -PathType Leaf
            if (-not $aExist -and -not $bExist) { Warn "Both missing: $sf"; continue }
            if (-not $aExist) { Fail "Missing here: $sf"; $allMatch = $false; continue }
            if (-not $bExist) { Fail "Missing peer: $sf"; $allMatch = $false; continue }
            
            $hashA = (Get-FileHash $a -Algorithm SHA256).Hash
            $hashB = (Get-FileHash $b -Algorithm SHA256).Hash
            if ($hashA -eq $hashB) { Pass "Match: $sf" }
            else { Fail "MISMATCH: $sf ($hashA vs $hashB)"; $allMatch = $false }
        }
        if ($allMatch) { Pass "All 8 sync files match peer" }
        else { Fail "Some files do not match peer" }
    } else { Warn "Peer path not found: $peerPath" }
}

# ===== SUMMARY =====

Write-Host ""
Write-Host "=== Result: $pass passed, $fail failed, $warn warnings ==="
if ($fail -gt 0) { exit 1 }
exit 0
