@echo off
REM Atlas billing sync - runs the agent and keeps a log
cd /d "%~dp0"
echo. >> sync.log
python sync.py >> sync.log 2>&1
if errorlevel 1 (
  echo SYNC FAILED - see sync.log
  exit /b 1
)
