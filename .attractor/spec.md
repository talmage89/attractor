# Outcomes Spec: DAG Ergonomics, Resume, Prompt Files, and Safety Timeouts

## 1. Comments in DAG Files

### Current State

The lexer (`parser/lexer.ts`) already strips `//` line comments and `/* */` block comments via `stripComments()` before tokenizing. Comments are fully supported at the parse level.

### Outcome

No parser changes needed — comments already work. The gap is **awareness**: there's no documentation, test coverage for edge cases, or LSP support (semantic tokens ignore comment regions since they operate on post-strip tokens).

### Acceptance

- [ ] Add explicit test cases for comments in various positions (inline after attributes, between node declarations, block comments spanning multiple lines)
- [ ] Ensure the LSP doesn't choke on comments (it uses the same lexer, so this should already work — verify)
- [ ] Document comment syntax in README

---

## 2. Resume Last Pipeline (Pick Up Where It Left Off)

### Current State

`attractor run <dotfile> --resume <checkpoint-path>` restores from an explicit checkpoint file. The user must locate the checkpoint path manually. There's no shortcut to resume the most recent run.

### Outcome

Add `attractor run <dotfile> --resume-last` that automatically finds and resumes from the most recent run's checkpoint.

### Behaviour

1. Scan `.attractor/runs/` for directories, sorted by name descending (ISO timestamps sort lexicographically)
2. Find the first directory containing a `checkpoint.json`
3. Read the checkpoint — if `currentNode` is the exit node AND the pipeline completed successfully (all goal gates satisfied), print "Last pipeline completed successfully, nothing to resume" and exit 0
4. Otherwise, resume from the checkpoint node — the pipeline picks up at the node where it stopped, with all prior state (completedNodes, context, sessions, retry counts) restored
5. The resumed run writes to a **new** logs directory (new timestamp), not the old one. The checkpoint is the only thing inherited from the prior run

### Edge Cases

- No prior runs → error: "No previous runs found in .attractor/runs/"
- Prior run's checkpoint references a node no longer in the graph → existing behaviour: warning + start from beginning
- `--resume` and `--resume-last` are mutually exclusive → error if both provided

### Acceptance

- [ ] `--resume-last` flag added to CLI
- [ ] Correctly identifies most recent run directory
- [ ] Resumes from checkpoint node, skipping already-completed nodes
- [ ] New logs directory created for resumed run
- [ ] Errors clearly when no prior runs exist

---

## 3. Prompt Files for DAG Nodes

### Current State

Node prompts are specified inline: `plan [prompt = "Read .attractor/prompts/sprint/plan.md and follow the instructions."]`. This is a workaround — the prompt text tells CC to go read a file, rather than providing the prompt content directly.

### Outcome

Add a `prompt_file` attribute that reads prompt content from a file at execution time. Path is relative to the `.attractor/` directory.

### Syntax

```dot
plan [shape = "box", prompt_file = "prompts/sprint/plan.md", llm_model = "opus"]
```

### Behaviour

1. **Parser**: Recognize `prompt_file` as a node attribute, store as `GraphNode.promptFile: string` (raw path as written)
2. **CodergenHandler**: At execution time, if `node.promptFile` is set and `node.prompt` is empty:
   - Resolve the path relative to the `.attractor/` directory
   - Read the file contents
   - Use contents as the prompt text
3. **Precedence**: `prompt` takes priority over `prompt_file`. If both are set, `prompt` wins and a validation warning is emitted
4. **Variable expansion**: `$goal` and any other transform-time variable substitution still applies to the file contents after reading
5. **Missing file**: If the file doesn't exist at execution time, the handler emits a `fail` outcome with a clear error message (not a crash)

### Validation Rules

- `prompt_file` on a non-codergen node (e.g., tool, start, exit) → `[warning]` "prompt_file has no effect on {type} nodes"
- Both `prompt` and `prompt_file` set → `[warning]` "prompt and prompt_file both set; prompt takes precedence"
- File not found at path relative to `.attractor/` → `[warning]` "prompt_file '{path}' not found"

### Acceptance

- [ ] `prompt_file` attribute parsed and stored on `GraphNode`
- [ ] CodergenHandler reads file and uses contents as prompt
- [ ] `prompt` takes precedence when both are set
- [ ] Variable expansion applies to file contents
- [ ] Missing file at runtime → fail outcome, not crash
- [ ] Validation warns on missing prompt files
- [ ] Validation warnings for conflicts and misuse
- [ ] LSP semantic tokens classify `prompt_file` values as `string` (path)

---

## 4. Default Graph-Wide Codergen Timeout

### Current State

Node-level timeouts are opt-in via `timeout = "15m"` on individual nodes. There is no graph-wide default — a node without an explicit timeout runs indefinitely.

### Outcome

Add a built-in default timeout of **1 hour** for all codergen nodes that don't specify their own timeout. Make this configurable via a graph attribute.

### Syntax

```dot
graph [default_timeout = "30m"]
```

Follows the existing `default_*` pattern (`default_max_retry`, `default_fidelity`).

### Behaviour

1. **Parser**: Recognize `default_timeout` in `applyGraphAttributeKV`, parse via existing `parseTimeout()`, store as `GraphAttributes.defaultTimeout: number | null`
2. **CodergenHandler**: When building CC options, use `node.timeout ?? graph.attributes.defaultTimeout ?? 3_600_000` (1h fallback)
3. **ToolHandler**: Also respects `default_timeout` — falls back to it before the existing 30s hardcoded default
4. **Node-level override**: `timeout` on a node always wins over the graph default

### Validation Rules

- Non-positive `default_timeout` → `[error]` "default_timeout must be a positive duration"

### Acceptance

- [ ] `default_timeout` graph attribute parsed and stored
- [ ] Codergen nodes without explicit timeout use graph default, falling back to 1h
- [ ] Node-level `timeout` overrides graph default
- [ ] Validation rejects non-positive values

---

## 5. Watchdog (Idle Process Detection)

### Current State

No idle detection. A CC process can hang (alive but producing no SDK events) and block the pipeline until an explicit timeout fires — which could be up to 30m+ away.

### Design

Full design in [artifacts/watchdog-design.md](artifacts/watchdog-design.md). Summary below.

### Syntax

```dot
graph [watchdog_idle = "5m", watchdog_poll = "30s"]
```

### Behaviour

1. **Opt-in only** — watchdog does not run unless `watchdog_idle` is set
2. **Polling**: A `setInterval` at `watchdog_poll` (default 30s when idle is set) checks each active node's `lastActivity` timestamp
3. **Activity tracking**: Every `cc_event` and `stage_started` event updates the node's last-activity timestamp
4. **Kill**: If a node has been idle longer than `watchdog_idle`, its `AbortController` fires, killing the CC process. A `warning` event is emitted
5. **Cleanup**: Timer is cleared at `pipeline_completed`

### Integration Points

- **runner.ts**: Owns the watchdog lifecycle (start after `pipeline_started`, clear at `pipeline_completed`)
- **wrappedOnEvent**: Updates `lastActivity` on `cc_event` and `stage_started`
- **Per-node AbortController**: Created before each node execution, registered with watchdog, threaded through `RunConfig.abortSignal` to `CCBackendOptions`
- **CodergenHandler**: Combines watchdog signal with timeout signal via event listener
- **ParallelHandler**: Branches get individual tracking (each branch node has a unique ID)

### Validation Rules

- `watchdog_poll` without `watchdog_idle` → `[warning]` "watchdog_poll has no effect without watchdog_idle"
- `watchdog_idle` < `watchdog_poll` → `[warning]` "watchdog_idle shorter than poll interval; idle nodes may not be detected promptly"
- Non-positive values → `[error]` "watchdog_idle must be a positive duration"

### Acceptance

- [ ] `watchdog_idle` and `watchdog_poll` graph attributes parsed
- [ ] Watchdog only activates when `watchdog_idle` is set
- [ ] Active nodes tracked via event stream heartbeats
- [ ] Idle nodes killed via AbortController after configured duration
- [ ] Warning event emitted on watchdog kill
- [ ] Parallel branches tracked independently
- [ ] Timer cleaned up at pipeline end
- [ ] Validation warnings for misconfiguration

---

## 6. Break on Result in `runCC`

### Current State

In `cc-backend.ts`, the `for await` loop continues iterating the SDK generator after receiving a `result` message. The result message is terminal — no meaningful messages follow it. If the generator hangs (doesn't close cleanly), the entire node blocks indefinitely.

### Outcome

Break out of the loop immediately after capturing the result message.

### Change

```typescript
// cc-backend.ts, line 77-78
} else if (msg.type === "result") {
  resultMessage = msg;
  break;  // Result is terminal — don't wait for generator to close
}
```

### Why This Is Safe

- The `result` message is the final semantic message from the SDK
- The `finally` block still runs (clears timeout)
- `sessionId` is captured from the earlier `init` message
- All event callbacks have already fired for prior messages
- This is a defence-in-depth fix: it mitigates hangs even without the watchdog

### Acceptance

- [ ] `break` added after `resultMessage = msg`
- [ ] Existing tests continue to pass
- [ ] Timeout cleanup still fires (verified by `finally` block)
