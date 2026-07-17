@echo off
REM ============================================================
REM  CinemaPlus - fix the >100MB all.json push problem and push
REM  Run this from inside your project folder:
REM    C:\Users\mohme\OneDrive\Desktop\web\cinemanaplus-have't
REM
REM  BEFORE running: extract cinemaplus-fix-v2.tar.gz into this
REM  folder so the new files (all.json.part-*, join script, etc.)
REM  overwrite the old ones.
REM ============================================================

echo.
echo === Step 1: rewind local main to the last commit that is
echo ===         already on GitHub (keeps all your files on disk) ===
git reset --soft 58d5887

echo.
echo === Step 2: stop tracking the giant all.json (ignore errors) ===
git rm --cached src/data/generated/all.json 2>nul

echo.
echo === Step 3: stage everything (the <45MB parts replace it) ===
git add -A

echo.
echo === Step 4: make sure the big file is really NOT staged ===
git reset -q -- src/data/generated/all.json 2>nul

echo.
echo === Step 5: show the biggest staged files (all must be < 100MB) ===
git status --short

echo.
echo === Step 6: commit ===
git commit -m "merge topcinemaa servers + 3526 new works; split all.json into <45MB parts (fix GitHub 100MB limit)"

echo.
echo === Step 7: push ===
git push origin main

echo.
echo === DONE. If the push still complains about all.json, run: ===
echo     verify_no_bigfile.bat
echo === and send me the output. ===
pause
