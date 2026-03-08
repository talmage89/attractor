## test_b — 2026-03-08T17:15:35.490Z

Testing complete. Here's a summary of what I found:

## test_b Results

**2 bugs found** (both in the `prompt_file` / `resume-last` areas I was assigned to test).

### Bug 1: `--resume-last` ignores `--cwd` (Medium)
`findLastCheckpoint()` hardcodes `.attractor/runs/` relative to `process.cwd()`, not the `--cwd` flag value. Running `attractor run /path/to/dag --cwd /project --resume-last` from a different shell directory fails with "No previous runs found" even when the checkpoint exists.

### Bug 2: `prompt_file_not_found` validation uses wrong base path (Low)
`promptFileNotFoundRule` resolves paths via `process.cwd()` but `CodergenHandler` at runtime uses `config.cwd`. Running `attractor validate /absolute/path/to/dag` from a different directory produces false positive `prompt_file_not_found` warnings even when files exist.

### All other tests passed (25+ integration scenarios):
- All 3 prompt_file validation rules work correctly
- `$goal` substitution in prompt_file contents works
- Missing prompt_file at runtime returns clean `fail` outcome (no crash)
- `prompt` correctly takes precedence over `prompt_file` at runtime
- All resume-last scenarios (mutual exclusion, no-runs error, nothing-to-resume detection, sorting, ghost nodes) work correctly
- All watchdog validation rules (secondary focus) work correctly