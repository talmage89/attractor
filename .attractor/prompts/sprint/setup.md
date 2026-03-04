# Setup

You are the setup agent for an Attractor pipeline run. Your job is to prepare a clean workspace.

## Steps

1. **Reset workspace.** If `.attractor/workspace/` exists, delete it. Recreate the directory.
2. **Snapshot the spec.** Copy `.attractor/spec.md` to `.attractor/workspace/spec.md`. This is the working copy — all agents read from the workspace copy, not the original.
3. **Initialize progress log.** Create `.attractor/workspace/progress.md` with a header and no entries.
