@echo off
REM Lists any file over ~99MB anywhere in your local git history.
REM If it prints nothing, your history is clean and push will succeed.
echo === Scanning git history for files > 99MB ... ===
git rev-list --objects --all > "%TEMP%\_objs.txt"
for /f "tokens=1,2" %%a in (%TEMP%\_objs.txt) do (
  for /f %%s in ('git cat-file -s %%a 2^>nul') do (
    if %%s GTR 103809024 echo %%s bytes  %%b
  )
)
echo === done ===
pause
