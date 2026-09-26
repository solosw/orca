@echo off
cd /d C:\software\projects\orca
echo === init a fresh repo (history is unrecoverable; this gives working git plumbing) ===
git init -q 2>&1
echo === set a local identity (repo-local only) ===
git config user.email "recovery@local" 2>&1
git config user.name "recovery" 2>&1
echo === state ===
git rev-parse --is-inside-work-tree 2>&1
git symbolic-ref --short HEAD 2>&1
echo === staged count after add (this is 29k files; do it quietly) ===
git add -A 2>&1 | findstr /v "^$"
echo === commit the restored baseline ===
git commit -q -m "Restore working tree from Orca snapshot store (baseline before ACP work)" 2>&1
echo === verify ===
git log --oneline -1 2>&1
git status --short 2>&1 | find /c /v ""
echo --- end ---