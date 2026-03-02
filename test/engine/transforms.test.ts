import { describe, it, expect } from "vitest";
import { parse } from "../../src/parser/parser";
import { applyTransforms } from "../../src/engine/transforms";

describe("transforms", () => {
  it("expands $goal in node prompts", () => {
    const graph = parse(`
      digraph G {
        graph [goal="Build auth system"]
        s [shape=Mdiamond]
        e [shape=Msquare]
        plan [prompt="Create a plan for: $goal"]
        s -> plan -> e
      }
    `);
    applyTransforms(graph);
    expect(graph.nodes.get("plan")?.prompt).toBe(
      "Create a plan for: Build auth system"
    );
  });

  it("applies stylesheet during transform", () => {
    const graph = parse(`
      digraph G {
        graph [model_stylesheet="* { llm_model: claude-sonnet-4-5; }"]
        s [shape=Mdiamond]
        e [shape=Msquare]
        a [shape=box]
        s -> a -> e
      }
    `);
    applyTransforms(graph);
    expect(graph.nodes.get("a")?.llmModel).toBe("claude-sonnet-4-5");
  });

  it("does not modify prompts without $goal", () => {
    const graph = parse(`
      digraph G {
        graph [goal="Something"]
        s [shape=Mdiamond]
        e [shape=Msquare]
        a [prompt="No variable here"]
        s -> a -> e
      }
    `);
    applyTransforms(graph);
    expect(graph.nodes.get("a")?.prompt).toBe("No variable here");
  });

  it("handles empty goal gracefully", () => {
    const graph = parse(`
      digraph G {
        s [shape=Mdiamond]
        e [shape=Msquare]
        a [prompt="Goal is: $goal"]
        s -> a -> e
      }
    `);
    applyTransforms(graph);
    expect(graph.nodes.get("a")?.prompt).toBe("Goal is: ");
  });

  it("expands $goal in tool_command", () => {
    const graph = parse(`
      digraph G {
        graph [goal="my-project"]
        s [shape=Mdiamond]
        e [shape=Msquare]
        t [shape=box, tool_command="build.sh $goal"]
        s -> t -> e
      }
    `);
    applyTransforms(graph);
    expect(graph.nodes.get("t")?.raw.get("tool_command")).toBe("build.sh my-project");
  });

  it("does not modify tool_command without $goal", () => {
    const graph = parse(`
      digraph G {
        graph [goal="ignored"]
        s [shape=Mdiamond]
        e [shape=Msquare]
        t [shape=box, tool_command="npm test"]
        s -> t -> e
      }
    `);
    applyTransforms(graph);
    expect(graph.nodes.get("t")?.raw.get("tool_command")).toBe("npm test");
  });

  it("silently skips invalid stylesheet without throwing (validator reports the error)", () => {
    const graph = parse(`
      digraph G {
        graph [model_stylesheet="* llm_model: bad }"]
        s [shape=Mdiamond]
        e [shape=Msquare]
        a [shape=box]
        s -> a -> e
      }
    `);
    // Must not throw — the validator's stylesheetSyntaxRule reports this as a diagnostic
    expect(() => applyTransforms(graph)).not.toThrow();
    // No stylesheet was applied, so llmModel stays as whatever the default is
    expect(graph.nodes.get("a")?.llmModel).not.toBe("bad");
  });
});
