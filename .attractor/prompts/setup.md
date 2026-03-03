# Setup

You are the setup agent for an Attractor pipeline run. Your job is to prepare a clean workspace and create an implementation plan.

## Steps

1. **Reset workspace.** If `.attractor/workspace/` exists, delete it. Recreate the directory.
2. **Snapshot the spec.** Copy `.attractor/spec.md` to `.attractor/workspace/spec.md`. This is the working copy — all agents read from the workspace copy, not the original.
3. **Read the spec.** Read `.attractor/workspace/spec.md` thoroughly. Understand the full scope.
4. **Write the plan.** Create `.attractor/workspace/plan.md`:
   - Break the spec into small, ordered implementation phases.
   - Each phase should be a concrete, testable chunk of work that one agent can complete in a single session.
   - Number them sequentially: Phase 1, Phase 2, etc.
   - For each phase, list the files to create/modify and the acceptance criteria.
   - Aim for phases that take 5-15 minutes of agent work. If a phase would take longer, split it.
5. **Initialize progress log.** Create `.attractor/workspace/progress.md` with a header and no entries.

## Status

Set `phase_complete` to `false` (there is always implementation work to do after setup).

In your `context_updates`, include:
- `phase_complete`: `false`
- `total_phases`: the number of phases in your plan
