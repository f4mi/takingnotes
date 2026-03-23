@echo off
setlocal

cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Error: node is not installed or not on PATH. 1>&2
  exit /b 1
)

node scripts\run.mjs build %*
