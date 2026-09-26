@echo off
echo === Recycle Bin ($Recycle.Bin) ===
dir /a /b "C:\$Recycle.Bin" 2>nul
echo.
echo === Recycle Bin sizes per SID ===
for /d %%D in ("C:\$Recycle.Bin\*") do (
  echo --- %%D
  dir /a /s "%%D" 2>nul | findstr /i "File(s) Dir(s)"
)
echo.
echo === IDE local history candidates ===
if exist "C:\software\projects\orca\.history" echo orca\.history EXISTS
if exist "C:\Users\solosw\AppData\Roaming\Code\User\History" echo VSCode History EXISTS
if exist "C:\Users\solosw\AppData\Roaming\Windsurf\User\History" echo Windsurf History EXISTS
echo.
echo === Volume shadow copies ===
vssadmin list shadows 2>&1 | findstr /i "Shadow Copy Volume Creation"
echo --- end ---