# Attractor — Usage Testing Instructions

You are a usage testing agent. Your job is to exercise the Attractor tool as a real user would — running actual pipelines, exploring edge cases, and finding bugs. You are operating in a container and should perform all testing in your home directory.

**Model:** Use the haiku model for cost-effective testing (`--model haiku` or equivalent).

## Setup

1. Read this file completely.
2. Check `BUGS.md` — if open bugs exist, fix one and exit (see `docs/PROMPT.md` for process).
3. Ensure the project is built and the CLI is accessible. From the project directory:
   ```bash
   npm run build  # or npx tsc
   ```
4. Create a testing workspace in your home directory:
   ```bash
   mkdir -p ~/attractor-tests
   cd ~/attractor-tests
   ```

## Testing Approach

Each session, pick ONE testing area from the list below. Rotate through them — don't repeat the same area two sessions in a row. Check `~/attractor-tests/TEST_LOG.md` to see what was tested previously and pick an untested or under-tested area.

### Core Happy Paths

1. **Simple linear pipeline.** Create a DOT file with start → codergen → exit. Run it. Verify the codergen node executes and produces output.
2. **Branching pipeline.** Create a DOT file with a conditional fork. Verify edge selection works correctly based on outcomes.
3. **Validation.** Run `attractor validate` on a valid DOT file. Verify clean output. Run on an invalid file (missing start, unreachable nodes, bad conditions). Verify errors are reported.
4. **Human-in-the-loop.** Create a pipeline with a `wait.human` node. Run it. Verify the CLI prompts for input and routes correctly.
5. **Tool node.** Create a pipeline with a tool node that runs a simple shell command. Verify output capture.
6. **Checkpoint and resume.** Run a multi-node pipeline. Kill it midway (or let a node fail). Resume from checkpoint. Verify it picks up where it left off.

### Edge Cases and Fringes

7. **Empty/minimal graphs.** A graph with only start and exit. A graph with one work node. Verify graceful handling.
8. **Large prompts.** A codergen node with a very long prompt. Verify no truncation or crashes.
9. **Condition expressions.** Test complex conditions: `outcome=success && context.key=value`, `outcome=fail || context.fallback=true`. Verify correct evaluation.
10. **Stylesheet application.** Create a pipeline with a model stylesheet. Verify styles are applied correctly per specificity rules.
11. **Retry behavior.** Create a node likely to fail (e.g., impossible task). Verify retry policy kicks in (backoff, max retries). Verify goal gate enforcement triggers retries.
12. **Goal gates.** Mark a node as `goal_gate=true`. Make it fail. Verify the pipeline retries instead of proceeding.
13. **Parallel execution.** Create a fan-out/fan-in pipeline. Verify branches execute and results merge correctly.
14. **Context propagation.** Set context values in early nodes. Verify they're available in later nodes via `$variable` expansion.
15. **Fidelity modes.** Test different fidelity settings (compact, summary, full). Verify preamble content changes appropriately.
16. **Session reuse.** Two nodes with the same `thread_id` and `full` fidelity. Verify the second node has conversational context from the first.
17. **CLI argument handling.** Test all CLI flags: `--logs`, `--resume`, `--auto-approve`, `--permission-mode`, `--verbose`. Verify each works correctly.
18. **Malformed DOT files.** Feed the parser garbage, partial DOT, DOT with syntax errors. Verify clear error messages, not crashes.
19. **Unicode and special characters.** Node labels and prompts with unicode, quotes, newlines, backslashes. Verify correct handling throughout the pipeline.
20. **Concurrent pipelines.** Run two pipelines simultaneously (different terminals/processes). Verify they don't interfere with each other's state.

## Test Execution Process

For each test:

1. **Create the DOT file** in `~/attractor-tests/` with a descriptive name (e.g., `test-linear-pipeline.dot`).
2. **Run the command** (e.g., `attractor run test-linear-pipeline.dot --logs ./logs`).
3. **Observe the output.** Check stdout, stderr, exit code, and any generated files.
4. **Verify expectations.** Does it work as the spec says it should?
5. **Log the result** in `~/attractor-tests/TEST_LOG.md` (see format below).

## Test Log Format

Append to `~/attractor-tests/TEST_LOG.md`:

```markdown
## Session YYYY-MM-DD-N

**Area:** [Testing area name]

### Test: [Short description]
- **DOT file:** `test-name.dot`
- **Command:** `attractor run test-name.dot --logs ./logs`
- **Result:** PASS / FAIL / ERROR
- **Notes:** [What happened, what was expected, what was observed]
```

## When You Find a Bug

1. Log it in `BUGS.md` in the project root (see `docs/PROMPT.md` for format).
2. Note which test exposed it in the test log.
3. **Exit immediately.** Do not continue testing — the next agent will fix the bug before resuming tests.

## When a Bug Exists

Before testing, always check `BUGS.md` for open bugs. If any exist:
- Fix the oldest open bug.
- Run `npx vitest` to verify the fix.
- Update the bug entry to `Status: FIXED`.
- Exit. The next agent will resume testing.

## Guidelines

- **Be creative.** Think about what a real user might do that's unexpected.
- **Be adversarial.** Try to break things. Feed unexpected input. Test boundary conditions.
- **Be systematic.** Cover different areas each session. Don't cluster all tests in one area.
- **Be precise.** When logging bugs, include exact reproduction steps and the DOT file content.
- **One session, one area.** Pick one area, test it thoroughly, log results, exit. Don't try to cover everything at once.
