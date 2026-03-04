# Setup

You are the setup agent for a continuous testing pipeline run. Your job is to prepare a clean workspace.

## Steps

1. **Reset workspace.** If `.attractor/workspace/` exists, delete it. Recreate the directory.
2. **Initialize progress log.** Create `.attractor/workspace/progress.md` with a header and no entries.
