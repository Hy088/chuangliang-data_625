@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo === Merge period CSVs and push to dashboard ===
"C:\Users\EDY\.workbuddy\binaries\python\versions\3.13.12\python.exe" -u import_period.py %*
echo.
echo === Done. Press any key to close ===
pause >nul
