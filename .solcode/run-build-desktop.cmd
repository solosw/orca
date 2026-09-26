@echo off
cd /d C:\software\projects\orca
call pnpm run build:desktop
echo --- build:desktop exit code: %ERRORLEVEL% ---