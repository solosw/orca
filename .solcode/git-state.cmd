@echo off
cd /d C:\software\projects\orca
echo === git state ===
git rev-parse --is-inside-work-tree 2>&1
echo === .git contents ===
dir /b .git 2>&1
echo === is there a donor .git to restore? ===
if exist "C:\software\projects\orca-recovery\orca-main.git\HEAD" (echo donor .git HEAD present) else (echo donor .git HEAD missing)
echo --- end ---