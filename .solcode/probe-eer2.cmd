@echo off
cd /d C:\software\projects\orca
echo === ensure:electron-runtime (the step build:win needs) ===
call pnpm run ensure:electron-runtime
echo --- exit code: %ERRORLEVEL% ---