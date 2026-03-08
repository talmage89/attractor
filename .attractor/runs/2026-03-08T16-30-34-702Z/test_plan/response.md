## test_plan — 2026-03-08T17:13:31.406Z

Test plan written to `.attractor/workspace/test-plan.md` with three agents:

- **test_a**: Primary on watchdog (highest risk — 5 files, full lifecycle), secondary on break-on-result & abort signal plumbing
- **test_b**: Primary on prompt_file (file I/O, $goal substitution, 3 validation rules) + resume-last (CLI scanning, checkpoint inspection), secondary on watchdog validation
- **test_c**: Primary on default_timeout (CodergenHandler + ToolHandler fallback chains) + comments + break-on-result, secondary on prompt_file validation

Every spec section has at least one primary assignment. High-risk areas (watchdog, prompt_file) have deliberate overlap via secondary assignments. Each agent has 5 concrete integration test scenarios including `.mjs` scripts and real CLI invocations.