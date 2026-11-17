@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo 找不到 Node.js。
  echo 可以改用：python -m http.server 8138
  echo.
  pause
  exit /b 1
)
node serve.mjs
pause
