import type { TextEdit } from "vscode-languageserver/node";
import type { TextDocument } from "vscode-languageserver-textdocument";
import { lex } from "attractor";
import type { Token } from "attractor";

// ─── CST types ───────────────────────────────────────────────────────────────

type AttrPair = { key: string; value: string };

type GraphAttr = { kind: "graph_attr"; key: string; value: string };
type DefaultsStmt = {
  kind: "defaults";
  target: "node" | "edge" | "graph";
  attrs: AttrPair[];
};
type NodeDecl = { kind: "node"; id: string; attrs: AttrPair[] };
type EdgeChain = { kind: "edge"; ids: string[]; attrs: AttrPair[] };
type Subgraph = { kind: "subgraph"; name?: string; stmts: CstStmt[] };
type CstStmt = GraphAttr | DefaultsStmt | NodeDecl | EdgeChain | Subgraph;

// ─── Attribute ordering ───────────────────────────────────────────────────────

const ATTR_ORDER: readonly string[] = [
  // Identity group
  "label",
  "shape",
  "type",
  "class",
  // Behavior group
  "prompt",
  "max_retries",
  "goal_gate",
  "retry_target",
  "fallback_retry_target",
  "fidelity",
  "timeout",
  "thread_id",
  // Model group
  "llm_model",
  "llm_provider",
  "reasoning_effort",
  // Flags group
  "auto_status",
  "allow_partial",
  // Edge-specific group
  "condition",
  "weight",
  "loop_restart",
];

function attrSortKey(key: string): [number, string] {
  const idx = ATTR_ORDER.indexOf(key);
  return idx >= 0 ? [idx, ""] : [ATTR_ORDER.length, key];
}

function sortAttrs(attrs: AttrPair[]): AttrPair[] {
  return [...attrs].sort((a, b) => {
    const [ai, ak] = attrSortKey(a.key);
    const [bi, bk] = attrSortKey(b.key);
    if (ai !== bi) return ai - bi;
    return ak.localeCompare(bk);
  });
}

// ─── ID and value quoting ─────────────────────────────────────────────────────

/** Quote a value for output (all attribute values are quoted per spec). */
function quoteValue(v: string): string {
  const escaped = v
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\t/g, "\\t");
  return `"${escaped}"`;
}

/** Emit an identifier: bare if it's a simple identifier/number, quoted otherwise. */
function emitId(s: string): string {
  if (/^[A-Za-z_][A-Za-z0-9_.]*$/.test(s) || /^-?[0-9]+(\.[0-9]+)?$/.test(s)) {
    return s;
  }
  return quoteValue(s);
}

// ─── CST parser ───────────────────────────────────────────────────────────────

class CstParser {
  private tokens: Token[];
  private pos = 0;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  private peek(): Token {
    return this.tokens[this.pos] ?? { kind: "EOF", value: "", line: 0, column: 0 };
  }

  private advance(): Token {
    return this.tokens[this.pos++] ?? { kind: "EOF", value: "", line: 0, column: 0 };
  }

  private check(kind: string): boolean {
    return this.peek().kind === kind;
  }

  private eat(kind: string): Token {
    const t = this.peek();
    if (t.kind !== kind) throw new Error(`Expected ${kind}, got ${t.kind} "${t.value}"`);
    return this.advance();
  }

  parseDocument(): { name: string; stmts: CstStmt[] } | null {
    try {
      if (!this.check("DIGRAPH")) return null;
      this.advance(); // digraph

      // Optional graph name (any token except LBRACE)
      let name = "";
      if (!this.check("LBRACE")) {
        name = this.peek().value;
        this.advance();
      }

      this.eat("LBRACE");
      const stmts = this.parseBody();
      this.eat("RBRACE");
      return { name, stmts };
    } catch {
      return null;
    }
  }

  private parseBody(): CstStmt[] {
    const stmts: CstStmt[] = [];
    while (!this.check("RBRACE") && !this.check("EOF")) {
      while (this.check("SEMICOLON")) this.advance();
      if (this.check("RBRACE") || this.check("EOF")) break;
      const stmt = this.parseStatement();
      if (stmt) stmts.push(stmt);
    }
    return stmts;
  }

  private parseStatement(): CstStmt | null {
    const t = this.peek();

    if (t.kind === "NODE") {
      this.advance();
      if (this.check("LBRACKET")) {
        const attrs = this.parseAttrBlocks();
        return { kind: "defaults", target: "node", attrs };
      }
      // "node" used as an identifier (e.g., edge starting at node named "node")
      return this.parseAfterFirstId("node");
    }

    if (t.kind === "EDGE") {
      this.advance();
      if (this.check("LBRACKET")) {
        const attrs = this.parseAttrBlocks();
        return { kind: "defaults", target: "edge", attrs };
      }
      return this.parseAfterFirstId("edge");
    }

    if (t.kind === "GRAPH") {
      this.advance();
      if (this.check("LBRACKET")) {
        const attrs = this.parseAttrBlocks();
        return { kind: "defaults", target: "graph", attrs };
      }
      return null;
    }

    if (t.kind === "SUBGRAPH") {
      return this.parseSubgraph();
    }

    if (
      t.kind === "IDENTIFIER" ||
      t.kind === "STRING" ||
      t.kind === "INTEGER" ||
      t.kind === "FLOAT" ||
      t.kind === "TRUE" ||
      t.kind === "FALSE" ||
      t.kind === "DURATION" ||
      t.kind === "DIGRAPH"
    ) {
      const first = this.advance();
      return this.parseAfterFirstId(first.value);
    }

    // Skip unrecognized tokens to avoid infinite loops
    this.advance();
    return null;
  }

  private parseAfterFirstId(firstId: string): CstStmt | null {
    // Graph attribute assignment: id = value
    if (this.check("EQUALS")) {
      this.advance(); // =
      const value = this.parseValue();
      return { kind: "graph_attr", key: firstId, value };
    }

    // Edge chain: id -> id -> ...
    if (this.check("ARROW")) {
      const ids = [firstId];
      while (this.check("ARROW")) {
        this.advance(); // ->
        ids.push(this.advance().value);
      }
      const attrs = this.check("LBRACKET") ? this.parseAttrBlocks() : [];
      return { kind: "edge", ids, attrs };
    }

    // Node declaration: id [attrs...]
    const attrs = this.check("LBRACKET") ? this.parseAttrBlocks() : [];
    return { kind: "node", id: firstId, attrs };
  }

  private parseSubgraph(): Subgraph {
    this.advance(); // subgraph keyword
    let name: string | undefined;
    if (!this.check("LBRACE")) {
      name = this.peek().value;
      this.advance();
    }
    this.eat("LBRACE");
    const stmts = this.parseBody();
    this.eat("RBRACE");
    return { kind: "subgraph", name, stmts };
  }

  private parseAttrBlocks(): AttrPair[] {
    const attrs: AttrPair[] = [];
    while (this.check("LBRACKET")) {
      this.advance(); // [
      while (!this.check("RBRACKET") && !this.check("EOF")) {
        if (this.check("COMMA") || this.check("SEMICOLON")) {
          this.advance();
          continue;
        }
        const key = this.advance().value;
        if (!this.check("EQUALS")) continue; // malformed, skip
        this.advance(); // =
        const value = this.parseValue();
        attrs.push({ key, value });
      }
      if (this.check("RBRACKET")) this.advance();
    }
    return attrs;
  }

  private parseValue(): string {
    return this.advance().value;
  }
}

// ─── Emitter ──────────────────────────────────────────────────────────────────

function emitAttrs(attrs: AttrPair[]): string {
  if (attrs.length === 0) return "";
  const sorted = sortAttrs(attrs);
  const parts = sorted.map((a) => `${a.key} = ${quoteValue(a.value)}`);
  return `[${parts.join(", ")}]`;
}

function emitNodeDecl(n: NodeDecl, prefix: string): string {
  const attrStr = emitAttrs(n.attrs);
  return attrStr ? `${prefix}${emitId(n.id)} ${attrStr}` : `${prefix}${emitId(n.id)}`;
}

function emitEdgeChain(e: EdgeChain, prefix: string): string {
  const chain = e.ids.map(emitId).join(" -> ");
  const attrStr = emitAttrs(e.attrs);
  return attrStr ? `${prefix}${chain} ${attrStr}` : `${prefix}${chain}`;
}

function emitDefaults(d: DefaultsStmt, prefix: string): string {
  const attrStr = emitAttrs(d.attrs);
  return attrStr ? `${prefix}${d.target} ${attrStr}` : `${prefix}${d.target}`;
}

function emitSubgraph(s: Subgraph, indent: number): string {
  const prefix = "  ".repeat(indent);
  const header = s.name ? `${prefix}subgraph ${emitId(s.name)} {` : `${prefix}subgraph {`;
  const body = emitBody(s.stmts, indent + 1);
  if (!body) return `${header}\n${prefix}}`;
  return `${header}\n${body}\n${prefix}}`;
}

function emitBody(stmts: CstStmt[], indent: number): string {
  const prefix = "  ".repeat(indent);

  const graphAttrs = stmts.filter((s): s is GraphAttr => s.kind === "graph_attr");
  const graphDefaults = stmts.filter(
    (s): s is DefaultsStmt => s.kind === "defaults" && s.target === "graph",
  );
  const nodeDefaults = stmts.filter(
    (s): s is DefaultsStmt => s.kind === "defaults" && s.target === "node",
  );
  const edgeDefaults = stmts.filter(
    (s): s is DefaultsStmt => s.kind === "defaults" && s.target === "edge",
  );
  const nodes = stmts.filter((s): s is NodeDecl => s.kind === "node");
  const edges = stmts.filter((s): s is EdgeChain => s.kind === "edge");
  const subgraphs = stmts.filter((s): s is Subgraph => s.kind === "subgraph");

  const sections: string[] = [];

  if (graphAttrs.length > 0) {
    sections.push(
      graphAttrs.map((a) => `${prefix}${a.key} = ${quoteValue(a.value)}`).join("\n"),
    );
  }

  if (graphDefaults.length > 0) {
    sections.push(graphDefaults.map((d) => emitDefaults(d, prefix)).join("\n"));
  }

  if (nodeDefaults.length > 0) {
    sections.push(nodeDefaults.map((d) => emitDefaults(d, prefix)).join("\n"));
  }

  if (edgeDefaults.length > 0) {
    sections.push(edgeDefaults.map((d) => emitDefaults(d, prefix)).join("\n"));
  }

  if (nodes.length > 0) {
    sections.push(nodes.map((n) => emitNodeDecl(n, prefix)).join("\n"));
  }

  if (edges.length > 0) {
    sections.push(edges.map((e) => emitEdgeChain(e, prefix)).join("\n"));
  }

  for (const sub of subgraphs) {
    sections.push(emitSubgraph(sub, indent));
  }

  return sections.join("\n\n");
}

function tryFormat(text: string): string | null {
  let tokens: Token[];
  try {
    tokens = lex(text);
  } catch {
    return null;
  }

  const parser = new CstParser(tokens);
  const doc = parser.parseDocument();
  if (doc === null) return null;

  const body = emitBody(doc.stmts, 1);
  const header = doc.name ? `digraph ${emitId(doc.name)} {` : "digraph {";

  if (!body) return `${header}\n}`;
  return `${header}\n${body}\n}`;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function format(doc: TextDocument): TextEdit[] {
  const text = doc.getText();
  const formatted = tryFormat(text);
  if (formatted === null) return [];

  const end = doc.positionAt(text.length);
  return [
    {
      range: {
        start: { line: 0, character: 0 },
        end,
      },
      newText: formatted,
    },
  ];
}
