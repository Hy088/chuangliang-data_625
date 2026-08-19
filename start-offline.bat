@echo off
chcp 65001 >nul
title 离线数据看板 - 便携版
echo ============================================
echo   数据看板 - 离线便携版
echo   断网也能看（启动后浏览器自动打开）
echo   关闭此窗口即可停止服务
echo ============================================
echo.

set "BASE=%~dp0"
cd /d "%BASE%"

set "SRV="

REM 1) node in PATH
where node >nul 2>nul
if %errorlevel%==0 (
  set "SRV=node"
  goto :run
)

REM 1.5) 本机 managed node（存在才用，其他电脑自动跳过）
if exist "C:\Users\EDY\.workbuddy\binaries\node\versions\22.22.2\node.exe" (
  set "SRV=nodelocal"
  goto :run
)

REM 2) python in PATH
where python >nul 2>nul
if %errorlevel%==0 (
  set "SRV=python"
  goto :run
)

REM 3) Windows 自带 PowerShell（任何电脑都有）
set "SRV=powershell"
goto :run

:run
echo 正在启动本地服务 (http://127.0.0.1:8788/) ...
if "%SRV%"=="node" (
  start "看板离线服务" node "%BASE%serve.js"
) else if "%SRV%"=="nodelocal" (
  start "看板离线服务" "C:\Users\EDY\.workbuddy\binaries\node\versions\22.22.2\node.exe" "%BASE%serve.js"
) else if "%SRV%"=="python" (
  start "看板离线服务" python -m http.server 8788 --bind 127.0.0.1 --directory "%BASE%"
) else (
  start "看板离线服务" powershell -NoProfile -ExecutionPolicy Bypass -File "%BASE%serve_offline.ps1"
)

timeout /t 2 >nul
echo 正在打开浏览器 ...
start "" http://127.0.0.1:8788/

echo.
echo 看板已打开。本窗口保持打开即可离线使用；
echo 用完请直接关闭此窗口（服务会一并停止）。
echo.
pause >nul
