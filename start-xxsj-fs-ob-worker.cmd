@echo off
chcp 65001 >nul
setlocal

rem xxsj-fs-ob Worker 双击启动器
rem 请将本文件与 start-xxsj-fs-ob-worker.ps1 放在同一个 Skill 根目录。
rem 本脚本使用自身目录定位 PowerShell 脚本，不依赖固定用户名或盘符。

set "PS_SCRIPT=%~dp0start-xxsj-fs-ob-worker.ps1"

if not exist "%PS_SCRIPT%" (
    echo [错误] 未找到：
    echo %PS_SCRIPT%
    echo.
    echo 请确认本 CMD 文件与 start-xxsj-fs-ob-worker.ps1 位于同一目录。
    pause
    exit /b 1
)

where pwsh.exe >nul 2>&1
if %errorlevel%==0 (
    pwsh.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%PS_SCRIPT%" %*
) else (
    powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%PS_SCRIPT%" %*
)

set "EXIT_CODE=%ERRORLEVEL%"

echo.
if "%EXIT_CODE%"=="0" (
    echo Worker 启动命令已执行。
) else (
    echo Worker 启动失败，退出代码：%EXIT_CODE%
)
echo.
pause
exit /b %EXIT_CODE%