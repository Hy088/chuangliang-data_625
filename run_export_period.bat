@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo === Export latest period from Chuangliang ===
"C:\Users\EDY\.workbuddy\binaries\python\versions\3.13.12\python.exe" -u export_period.py %*
echo.
echo === Done. Press any key to close ===
pause >nul
