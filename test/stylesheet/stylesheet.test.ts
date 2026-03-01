import { describe, it, expect } from "vitest";
import { parseStylesheet } from "../../src/stylesheet/parser";
import { applyStylesheet } from "../../src/stylesheet/applicator";
import { parse } from "../../src/parser/parser";

describe("stylesheet parser", () => {
  it("parses universal selector", () => {
    const rules = parseStylesheet(`* { llm_model: claude-sonnet-4-5; }`);
    expect(rules).toHaveLength(1);
    expect(rules[0].selector).toEqual({ type: "universal" });
    expect(rules[0].declarations.get("llm_model")).toBe("claude-sonnet-4-5");
  });

  it("parses class selector", () => {
    const rules = parseStylesheet(`.code { llm_model: claude-opus-4-6; }`);
    expect(rules[0].selector).toEqual({ type: "class", className: "code" });
  });

  it("parses id selector", () => {
    const rules = parseStylesheet(`#review { reasoning_effort: high; }`);
    expect(rules[0].selector).toEqual({ type: "id", nodeId: "review" });
  });

  it("parses multiple declarations", () => {
    const rules = parseStylesheet(`* { llm_model: claude-sonnet-4-5; llm_provider: anthropic; reasoning_effort: medium; }`);
    expect(rules[0].declarations.size).toBe(3);
  });

  it("parses multiple rules", () => {
    const rules = parseStylesheet(`
      * { llm_model: claude-sonnet-4-5; }
      .code { llm_model: claude-opus-4-6; }
      #critical { reasoning_effort: high; }
    `);
    expect(rules).toHaveLength(3);
  });

  it("throws on malformed stylesheet", () => {
    expect(() => parseStylesheet(`* llm_model: foo; }`)).toThrow();
  });
});

describe("stylesheet applicator", () => {
  it("applies universal rule to all nodes", () => {
    const graph = parse(`
      digraph G {
        s [shape=Mdiamond]
        e [shape=Msquare]
        a [shape=box]
        b [shape=box]
        s -> a -> b -> e
      }
    `);
    const rules = parseStylesheet(`* { llm_model: claude-sonnet-4-5; }`);
    applyStylesheet(graph, rules);
    expect(graph.nodes.get("a")?.llmModel).toBe("claude-sonnet-4-5");
    expect(graph.nodes.get("b")?.llmModel).toBe("claude-sonnet-4-5");
  });

  it("class selector overrides universal", () => {
    const graph = parse(`
      digraph G {
        s [shape=Mdiamond]
        e [shape=Msquare]
        a [shape=box, class="code"]
        b [shape=box]
        s -> a -> b -> e
      }
    `);
    const rules = parseStylesheet(`
      * { llm_model: claude-sonnet-4-5; }
      .code { llm_model: claude-opus-4-6; }
    `);
    applyStylesheet(graph, rules);
    expect(graph.nodes.get("a")?.llmModel).toBe("claude-opus-4-6");
    expect(graph.nodes.get("b")?.llmModel).toBe("claude-sonnet-4-5");
  });

  it("id selector overrides class", () => {
    const graph = parse(`
      digraph G {
        s [shape=Mdiamond]
        e [shape=Msquare]
        review [shape=box, class="code"]
        s -> review -> e
      }
    `);
    const rules = parseStylesheet(`
      .code { llm_model: claude-opus-4-6; }
      #review { llm_model: gpt-5; }
    `);
    applyStylesheet(graph, rules);
    expect(graph.nodes.get("review")?.llmModel).toBe("gpt-5");
  });

  it("explicit node attribute overrides stylesheet", () => {
    const graph = parse(`
      digraph G {
        s [shape=Mdiamond]
        e [shape=Msquare]
        a [shape=box, llm_model="my-model"]
        s -> a -> e
      }
    `);
    const rules = parseStylesheet(`* { llm_model: claude-sonnet-4-5; }`);
    applyStylesheet(graph, rules);
    expect(graph.nodes.get("a")?.llmModel).toBe("my-model");
  });
});
