@echo off
chcp 65001 >nul
cd /d "%~dp0"
"C:\Users\EDY\.workbuddy\binaries\python\versions\3.13.12\python.exe" set_period_credentials.py
echo.
pause
