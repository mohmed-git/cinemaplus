CinemaPlus - fix the "all.json exceeds 100MB" push error
=========================================================

WHAT HAPPENED
  all.json grew to 150MB after the merge. GitHub rejects any file > 100MB,
  and an old commit in your local history still carried the big file.

THE FIX (do these in order)

  1) Extract cinemaplus-fix-v2.tar.gz INTO your project folder
     (C:\Users\mohme\OneDrive\Desktop\web\cinemanaplus-have't),
     overwriting existing files. It adds:
        - src/data/generated/all.json.part-000..003  (<45MB each)
        - src/data/generated/all.json.parts.json
        - scripts/join-all-json.mjs  (rebuilds all.json at build time)
        - scripts/split-all-json.mjs
        - updated package.json + .gitignore + the merged catalogue data

  2) Double-click  FIX_AND_PUSH.bat   (run it inside the project folder).
     This rewinds to the last good commit, drops the big all.json, commits
     the <45MB parts, and pushes.

  3) If the push STILL fails with an all.json size error, double-click
     NUCLEAR_FIX.bat  - it strips all.json from the ENTIRE history and
     force-pushes a clean history. (Safe: your files on disk are untouched.)

  4) verify_no_bigfile.bat  - optional, lists any >99MB file left in history.
     If it prints nothing, you're clean.

HOW IT WORKS AFTER THIS
  all.json is no longer stored in git. On every build (local or Cloudflare),
  "npm run build" first runs join-all-json.mjs which reassembles all.json
  from the committed parts - byte-identical - then builds normally.
  Nothing else in your workflow changes.
