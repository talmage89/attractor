# Attractor

A DAG pipeline execution engine. Define pipelines as DOT files; run them with Claude Code as the execution backend.

## DAG File Syntax

Pipeline graphs are written in a subset of the [Graphviz DOT language](https://graphviz.org/doc/info/lang.html).

### Comments

Both line and block comments are supported and are stripped before parsing.

```dot
// This is a line comment — everything after // is ignored until end of line

/* This is a block comment.
   It can span multiple lines. */

digraph Pipeline {
  graph [goal = "Run tests"] // inline comment after attribute

  start [
    shape = Mdiamond // diamond marks the start node
  ]

  plan [
    shape = box,
    /* prompt = "commented out" */
    prompt = "Create an implementation plan"
  ]

  exit [shape = Msquare]

  start -> plan  // first edge
  plan -> exit   /* second edge */
}
```

Comments may appear:
- Between node or edge declarations
- Inline after any attribute value
- Inside attribute blocks `[...]`
- Spanning multiple lines (block comments only)

### Basic Structure

```dot
digraph PipelineName {
  // Graph-level attributes
  graph [goal = "What this pipeline achieves"]

  // Nodes
  start [shape = Mdiamond]
  myNode [shape = box, prompt = "Do some work"]
  exit  [shape = Msquare]

  // Edges
  start -> myNode -> exit
}
```

### Node Shapes

| Shape       | Meaning              |
|-------------|----------------------|
| `Mdiamond`  | Start node           |
| `Msquare`   | Exit node            |
| `box`       | Codergen (LLM) node  |
| `component` | Parallel fan-out     |
| `diamond`   | Conditional router   |
| `oval`      | Tool execution node  |

## CLI

```
attractor run <dotfile> [options]
attractor validate <dotfile>
attractor visualize <dotfile>
```

### Run Options

| Flag                        | Description                                              |
|-----------------------------|----------------------------------------------------------|
| `--cwd <path>`              | Working directory for tool/codergen execution            |
| `--resume <checkpoint>`     | Resume from an explicit checkpoint file                  |
| `--resume-last`             | Resume from the most recent run's checkpoint             |
| `--log-dir <path>`          | Directory for run logs (default: `.attractor/runs/`)     |
| `--verbose`                 | Emit all SDK events to stderr                            |
