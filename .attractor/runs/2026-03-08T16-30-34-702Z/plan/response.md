## plan — 2026-03-08T16:30:34.715Z

Plan created and committed. The 7 phases are:

1. **Break on Result** — single `break` in `cc-backend.ts` (trivial)
2. **Comment Test Coverage** — add parser tests for comment edge cases
3. **Default Timeout** — `default_timeout` graph attribute for codergen/tool nodes
4. **Prompt Files** — `prompt_file` attribute to read prompts from files
5. **Resume Last** — `--resume-last` CLI flag to auto-find latest checkpoint
6. **Watchdog: Parsing & State** — `watchdog_idle`/`watchdog_poll` attrs + state model
7. **Watchdog: Runtime** — wire watchdog into runner, codergen, parallel handlers