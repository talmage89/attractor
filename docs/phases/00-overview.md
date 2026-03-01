# Implementation Phases — Overview

Eight phases, each delivering a testable milestone. Each phase builds on the previous.
No phase requires the CC SDK until Phase 7. Phases 1-6 are pure logic with no external
dependencies.

```
Phase 1: Types + DOT Parser
  │
  ├── Phase 2: Validation
  │
  ├── Phase 3: Conditions + Stylesheet + Transforms
  │
  └── Phase 4: State Management
        │
        └── Phase 5: Execution Engine
              │
              ├── Phase 6: Handlers (Simple + Human)
              │
              ├── Phase 7: CC Backend + Codergen Handler
              │
              └── Phase 8: Parallel Handlers + CLI + Integration
```

## Dependency Graph

| Phase | Depends On | Files Produced | Test Count (approx) |
|-------|-----------|----------------|---------------------|
| 1 | — | 7 source + 3 test | ~30 |
| 2 | 1 | 3 source + 1 test | ~15 |
| 3 | 1 | 5 source + 2 test | ~20 |
| 4 | 1 | 5 source + 2 test | ~15 |
| 5 | 1-4 | 5 source + 2 test | ~25 |
| 6 | 5 | 8 source + 3 test | ~20 |
| 7 | 5,6 | 4 source + 2 test | ~15 |
| 8 | 1-7 | 4 source + 2 test | ~15 |

**Total: ~41 source files, ~17 test files, ~155 test cases**

## Validation Strategy

Each phase has three validation tiers:

1. **Unit tests** — individual functions and classes in isolation.
2. **Integration tests** — modules composed together within the phase.
3. **Regression gate** — all previous phase tests must still pass.

Run `vitest` after each phase. No phase is complete until all tests pass
(current and prior).

## How to Use These Phase Specs

Each phase spec (01 through 08) contains:

- **Scope**: exactly which files to create
- **Dependencies**: what must exist from prior phases
- **Implementation notes**: specific behaviors and edge cases
- **Test fixtures**: actual input/output pairs, ready to become test files
- **Completion criteria**: how to know the phase is done
