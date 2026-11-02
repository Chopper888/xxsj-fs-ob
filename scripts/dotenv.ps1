# 读取 .env 中单个键的值；找不到返回 $null。仅供启动/检查脚本使用。
function Get-DotEnvValue([string]$Path, [string]$Key) {
    if (-not (Test-Path -LiteralPath $Path)) { return $null }
    foreach ($line in Get-Content -LiteralPath $Path -Encoding UTF8) {
        if ($line -match '^\s*#' -or $line -notmatch '=') { continue }
        $idx = $line.IndexOf('=')
        if ($idx -lt 1) { continue }
        if ($line.Substring(0, $idx).Trim() -ne $Key) { continue }
        $value = $line.Substring($idx + 1).Trim()
        if ($value.Length -ge 2) {
            $quoted = ($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'"))
            if ($quoted) { $value = $value.Substring(1, $value.Length - 2) }
        }
        return $value
    }
    return $null
}
