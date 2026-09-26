@echo off
cd /d C:\software\projects\orca
echo === is this a git work tree? ===
git rev-parse --is-inside-work-tree
echo === HEAD ===
git rev-parse --short HEAD
echo === branch ===
git branch --show-current
echo === status (short) ===
git status --short
echo === log -3 ===
git log --oneline -3
echo === stash list ===
git stash list
echo === reflog -5 ===
git reflog -5
echo === .git size ===
dir /s "C:\software\projects\orca\.git" 2>nul | findstr /i "File(s)"
echo --- end ---