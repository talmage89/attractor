## BUG-001: node_modules committed to git; .gitignore missing

- **Status:** OPEN
- **Found during:** Phase 1 / Project Setup
- **File(s):** `.gitignore`, `node_modules/`
- **Description:** The project has no `.gitignore` file, so `node_modules/` (1752 files) was committed to the repository. This bloats the repo and is incorrect practice.
- **Expected:** A `.gitignore` should exist with at least `node_modules/` listed. The `node_modules/` directory should not be tracked by git.
- **Actual:** No `.gitignore` exists. All of `node_modules/` is tracked and committed.
- **Fix:** Create `.gitignore` with `node_modules/` (and other standard entries like `dist/`, `*.tsbuildinfo`). Then run `git rm -r --cached node_modules/` to untrack the directory, and commit the result.
