@echo off
chcp 65001 >nul
title 离线看板服务
echo ============================================
echo   李虹玉 创量数据看板 - 离线模式
echo   断网也能看（启动后浏览器自动打开）
echo   关闭此窗口即可停止服务
echo ============================================
echo.

REM 优先用系统 PATH 里的 node，找不到再用本机 managed 路径
set "NODE=node"
where node >nul 2>nul || set "NODE=C:\Users\EDY\.workbuddy\binaries\node\versions\22.22.2\node.exe"

echo 正在启动本地服务 (http://localhost:8788/) ...
start "看板离线服务" "%NODE%" "C:\Users\EDY\chuangliang_data\serve.js"

REM 等服务器起来
timeout /t 2 >nul

echo 正在打开浏览器 ...
start "" http://localhost:8788/

echo.
echo 看板已打开。本窗口保持打开即可离线使用；
echo 用完请直接关闭此窗口（服务会一并停止）。
echo.
pause >nul
