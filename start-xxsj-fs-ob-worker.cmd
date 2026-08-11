@echo off
setlocal

set "PS_SCRIPT=%~dp0start-xxsj-fs-ob-worker.ps1"

if not exist "%PS_SCRIPT%" (
    echo ERROR: launcher PowerShell script not found.
    echo %PS_SCRIPT%
    pause
    exit /b 2
)

where pwsh.exe >nul 2>&1
if %errorlevel%==0 (
    pwsh.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%PS_SCRIPT%" %*
) else (
    powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%PS_SCRIPT%" %*
)

set "EXIT_CODE=%ERRORLEVEL%"
if not "%EXIT_CODE%"=="0" (
    echo.
    echo ERROR: Worker launcher failed. Exit code: %EXIT_CODE%
    pause
)

exit /b %EXIT_CODE%
