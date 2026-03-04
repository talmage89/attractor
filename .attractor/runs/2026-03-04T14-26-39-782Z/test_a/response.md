## test_a — 2026-03-04T15:04:21.364Z

Testing complete. Here's a summary of what I found:

## Results: 2 bugs found

### BUG-A01 (High): Invalid `foreach_key` context → pipeline silently succeeds
When `foreach_key` contains invalid JSON, a non-array JSON value, or references a missing context key:
- `executeDynamic()` correctly returns `{status: "fail"}` with a clear error message
- But the runner follows the unconditional template edge (`fanout → proc`) anyway
- The template node runs as a regular linear node; fan-in fails with "No parallel results"
- The exit handler always succeeds → pipeline reports **success** with exit code 0

**Expected**: Pipeline should fail with exit code 1.

### BUG-A02 (Medium): `FanInHandler` fails when `parallel.results = "[]"` (0 branches)
When `foreach_key` points to an empty array `[]`, the dynamic parallel handler correctly emits events and sets `parallel.results = "[]"`. But `FanInHandler` hits its `outcomes.length === 0` guard and returns fail with "No parallel results" — treating a valid empty result as absent results.

### What worked correctly
- Happy-path 3-item dynamic parallel (events, cleanup, ordering) ✓
- `max_parallel=1` sequential ordering ✓  
- Multi-node template chains ✓
- Validation rules (`foreach_key_valid`) ✓
- Static parallel regression ✓
- CLI parallel event format matches spec ✓
- Events appear in default (non-verbose) output ✓
- `totalBranches` field, 1-based display, 0-based `branchIndex` ✓

---

## test_a — 2026-03-04T15:26:55.708Z

Done. Here's a summary of what I did:

## test_a Results: No bugs found

**90 integration tests ran across 3 scratch scripts, all passing.**

### What was tested:
1. **foreach_key happy path** — 3-item array, 3 branches spawned, correct parallel events (`parallel_started`, `parallel_branch_completed`, `parallel_completed`) with correct fields
2. **Parallel event visibility** — confirmed `⊞` and `├` lines appear in CLI stderr without `--verbose`
3. **Error paths** — invalid JSON fails with descriptive message, non-array JSON fails, missing key fails, all with `suggestedNextIds=[]` stopping traversal (BUG-A01 fix confirmed)
4. **Empty array** — succeeds with 0 branches (BUG-A02 fix confirmed)
5. **Template chain (3 nodes)** — all synthetic nodes/edges cloned per item and cleaned up after execution; graph fully restored
6. **max_parallel throttling** — `max_parallel=2` on 4 items at 0.3s each: ~619ms (2 batches, not sequential); default `max_parallel=4` with 8 items: ~635ms
7. **Custom item_key** — works correctly
8. **foreachKeyValidRule** — warns on wrong shape, warns on 2+ edges, silent on correct config
9. **Large array (20 items)** — all 20 branches ran successfully with `max_parallel=4`
10. **Checkpoint hygiene** — synthetic node IDs not persisted in `completedNodes`

### Observations (non-bugs):
- **OBS-A1**: Missing context key error says "not valid JSON" (technically correct but slightly misleading vs. "key not found")
- **OBS-A2**: `$item` is not substituted in `tool_command` — only `$goal` is (by design; item_key is for LLM prompts)