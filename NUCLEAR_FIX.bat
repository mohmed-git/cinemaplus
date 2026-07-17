@echo off
REM ============================================================
REM  NUCLEAR FIX - only run this if FIX_AND_PUSH.bat still fails
REM  with "all.json ... exceeds GitHub's file size limit".
REM
REM  This removes src/data/generated/all.json from the ENTIRE git
REM  history (every commit), so no oversized blob can block the
REM  push. Your working files stay on disk untouched.
REM
REM  Run from inside the project folder.
REM ============================================================

echo.
echo === Removing all.json from ALL git history (may take a minute) ===
git filter-branch --force --index-filter "git rm --cached --ignore-unmatch src/data/generated/all.json" --prune-empty --tag-name-filter cat -- --all

echo.
echo === Cleaning up refs and garbage ===
rmdir /s /q .git\refs\original 2>nul
git reflog expire --expire=now --all
git gc --prune=now --aggressive

echo.
echo === Make sure all.json is ignored so it never comes back ===
findstr /c:"src/data/generated/all.json" .gitignore >nul || echo src/data/generated/all.json>> .gitignore
git add .gitignore
git commit -m "chore: ignore all.json (rebuilt from parts at build time)" 2>nul

echo.
echo === Force-push the cleaned history ===
git push origin main --force

echo.
echo === DONE ===
pause
