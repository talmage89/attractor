export const MINIMAL_LINEAR = `
digraph Simple {
  start [shape=Mdiamond]
  exit  [shape=Msquare]
  start -> exit
}
`;

export const THREE_NODE_LINEAR = `
digraph Pipeline {
  graph [goal="Run tests"]
  rankdir=LR

  start [shape=Mdiamond, label="Start"]
  exit  [shape=Msquare, label="Exit"]
  run_tests [label="Run Tests", prompt="Run the test suite"]

  start -> run_tests -> exit
}
`;

export const BRANCHING = `
digraph Branch {
  graph [goal="Implement feature"]
  node [shape=box, timeout="900s"]

  start     [shape=Mdiamond]
  exit      [shape=Msquare]
  plan      [label="Plan", prompt="Plan the implementation"]
  implement [label="Implement", prompt="Write code"]
  gate      [shape=diamond, label="Tests passing?"]

  start -> plan -> implement -> gate
  gate -> exit      [label="Yes", condition="outcome=success"]
  gate -> implement [label="No", condition="outcome!=success"]
}
`;

export const WITH_HUMAN_GATE = `
digraph Review {
  rankdir=LR
  start [shape=Mdiamond]
  exit  [shape=Msquare]

  review_gate [shape=hexagon, label="Review Changes"]

  start -> review_gate
  review_gate -> ship_it [label="[A] Approve"]
  review_gate -> fixes   [label="[F] Fix"]
  ship_it -> exit
  fixes -> review_gate
}
`;

export const WITH_ATTRIBUTES = `
digraph Full {
  graph [
    goal="Full attribute test",
    label="Test Pipeline",
    default_max_retry=3,
    model_stylesheet="* { llm_model: claude-sonnet-4-5; }"
  ]

  start [shape=Mdiamond]
  exit  [shape=Msquare]

  plan [
    label="Plan",
    shape=box,
    prompt="Plan for: $goal",
    max_retries=2,
    goal_gate=true,
    timeout="15m",
    reasoning_effort="high",
    class="planning,critical"
  ]

  start -> plan -> exit
}
`;

export const WITH_SUBGRAPH = `
digraph Sub {
  start [shape=Mdiamond]
  exit  [shape=Msquare]

  subgraph cluster_loop {
    label = "Main Loop"
    node [thread_id="main-loop", timeout="900s"]

    plan      [label="Plan"]
    implement [label="Implement", timeout="1800s"]
  }

  start -> plan -> implement -> exit
}
`;

// BUG-013: nodes declared BEFORE label = ... must also get the derived class
export const WITH_SUBGRAPH_LABEL_AFTER_NODES = `
digraph Sub2 {
  start [shape=Mdiamond]
  exit  [shape=Msquare]

  subgraph cluster_section {
    before_node [type=tool]
    label = "highlight"
    after_node [type=tool]
  }

  start -> before_node -> after_node -> exit
}
`;

export const WITH_COMMENTS = `
// This is a comment
digraph Commented {
  /* Block comment
     spanning lines */
  start [shape=Mdiamond] // inline comment
  exit  [shape=Msquare]
  start -> exit
}
`;

export const PARALLEL = `
digraph Par {
  start [shape=Mdiamond]
  exit  [shape=Msquare]

  fan_out  [shape=component, label="Fan Out"]
  fan_in   [shape=tripleoctagon, label="Fan In"]
  branch_a [label="Branch A", prompt="Do A"]
  branch_b [label="Branch B", prompt="Do B"]

  start -> fan_out
  fan_out -> branch_a
  fan_out -> branch_b
  branch_a -> fan_in
  branch_b -> fan_in
  fan_in -> exit
}
`;

export const EDGE_WEIGHTS = `
digraph Weights {
  start [shape=Mdiamond]
  exit  [shape=Msquare]
  node_a [label="A"]
  node_b [label="B"]
  node_c [label="C"]

  start -> node_a
  node_a -> node_b [weight=10]
  node_a -> node_c [weight=5]
  node_b -> exit
  node_c -> exit
}
`;

// BUG-016: quoted strings as node IDs (all-quoted)
export const WITH_QUOTED_NODE_IDS = `
digraph g {
  "start" [shape=Mdiamond]
  "work" [type=tool]
  "end" [shape=Msquare]
  "start" -> "work"
  "work" -> "end"
}
`;

// BUG-016: quoted strings as node IDs (mixed quoted and unquoted)
export const WITH_MIXED_QUOTED_NODE_IDS = `
digraph g {
  start [shape=Mdiamond]
  "work" [type=tool]
  end [shape=Msquare]
  start -> "work" -> end
}
`;

// --- Invalid DOT for error testing ---

export const INVALID_UNDIRECTED = `
graph Undirected {
  a -- b
}
`;

export const INVALID_NO_DIGRAPH = `
a -> b
`;

export const INVALID_UNCLOSED_STRING = `
digraph Bad {
  a [label="unclosed]
}
`;
