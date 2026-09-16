@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is required. Install the current LTS release, then run this launcher again.
  pause
  exit /b 1
)
node serve.mjs --open
if errorlevel 1 pause
endlocal
