import type { TextEdit } from "vscode-languageserver/node";
import type { TextDocument } from "vscode-languageserver-textdocument";
import { lex } from "attractor";
import type { Token } from "attractor";

// ─── CST types ───────────────────────────────────────────────────────────────

type AttrPair = { key: string; value: string };

type GraphAttr = { kind: "graph_attr"; key: string; value: string; startLine: number; endLine: number };
type DefaultsStmt = {
  kind: "defaults";
  target: "node" | "edge" | "graph";
  attrs: AttrPair[];
  startLine: number;
  endLine: number;
};
type NodeDecl = { kind: "node"; id: string; attrs: AttrPair[]; startLine: number; endLine: number };
type EdgeChain = { kind: "edge"; ids: string[]; attrs: AttrPair[]; startLine: number; endLine: number };
type Subgraph = { kind: "subgraph"; name?: string; stmts: CstStmt[]; startLine: number; endLine: number };
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
  private lastLine = 0;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  private peek(): Token {
    return this.tokens[this.pos] ?? { kind: "EOF", value: "", line: 0, column: 0 };
  }

  private advance(): Token {
    const t = this.tokens[this.pos++] ?? { kind: "EOF", value: "", line: 0, column: 0 };
    this.lastLine = t.line;
    return t;
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
    const startLine = this.peek().line;
    const stmt = this.parseStatementCore();
    if (stmt === null) return null;
    stmt.startLine = startLine;
    stmt.endLine = this.lastLine;
    return stmt;
  }

  private parseStatementCore(): CstStmt | null {
    const t = this.peek();

    if (t.kind === "NODE") {
      this.advance();
      if (this.check("LBRACKET")) {
        const attrs = this.parseAttrBlocks();
        return { kind: "defaults", target: "node", attrs, startLine: 0, endLine: 0 };
      }
      // "node" used as an identifier (e.g., edge starting at node named "node")
      return this.parseAfterFirstId("node");
    }

    if (t.kind === "EDGE") {
      this.advance();
      if (this.check("LBRACKET")) {
        const attrs = this.parseAttrBlocks();
        return { kind: "defaults", target: "edge", attrs, startLine: 0, endLine: 0 };
      }
      return this.parseAfterFirstId("edge");
    }

    if (t.kind === "GRAPH") {
      this.advance();
      if (this.check("LBRACKET")) {
        const attrs = this.parseAttrBlocks();
        return { kind: "defaults", target: "graph", attrs, startLine: 0, endLine: 0 };
      }
      // "graph" used as an identifier (e.g., edge starting at node named "graph")
      return this.parseAfterFirstId("graph");
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
      return { kind: "graph_attr", key: firstId, value, startLine: 0, endLine: 0 };
    }

    // Edge chain: id -> id -> ...
    if (this.check("ARROW")) {
      const ids = [firstId];
      while (this.check("ARROW")) {
        this.advance(); // ->
        ids.push(this.advance().value);
      }
      const attrs = this.check("LBRACKET") ? this.parseAttrBlocks() : [];
      return { kind: "edge", ids, attrs, startLine: 0, endLine: 0 };
    }

    // Node declaration: id [attrs...]
    const attrs = this.check("LBRACKET") ? this.parseAttrBlocks() : [];
    return { kind: "node", id: firstId, attrs, startLine: 0, endLine: 0 };
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
    return { kind: "subgraph", name, stmts, startLine: 0, endLine: 0 };
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

// ─── Emitter helpers ──────────────────────────────────────────────────────────

/**
 * Returns true if `a` and `b` are directly adjacent in `allStmts` (no other
 * statements between them) AND had at least one blank line between them in the
 * original source.  Both conditions must hold before we emit a blank line.
 */
function hadBlankLineBetween(allStmts: CstStmt[], a: CstStmt, b: CstStmt): boolean {
  const ai = allStmts.indexOf(a);
  const bi = allStmts.indexOf(b);
  if (bi !== ai + 1) return false; // not adjacent in source
  return b.startLine - a.endLine >= 2;
}

/**
 * Split `items` into alignment blocks. A new block starts whenever two
 * consecutive items had a blank line between them in the original source.
 */
function splitBlocks<T extends CstStmt>(allStmts: CstStmt[], items: T[]): T[][] {
  if (items.length === 0) return [];
  const blocks: T[][] = [[items[0]]];
  for (let i = 1; i < items.length; i++) {
    if (hadBlankLineBetween(allStmts, items[i - 1], items[i])) {
      blocks.push([]);
    }
    blocks[blocks.length - 1].push(items[i]);
  }
  return blocks;
}

// ─── Block-level aligned emitters ────────────────────────────────────────────

/** Emit a block of graph-attribute statements, aligning the `=` signs. */
function emitGraphAttrBlock(block: GraphAttr[], prefix: string): string {
  const maxKeyLen = Math.max(...block.map((a) => a.key.length));
  return block
    .map((a) => `${prefix}${a.key.padEnd(maxKeyLen)} = ${quoteValue(a.value)}`)
    .join("\n");
}

/** Emit a block of defaults statements, aligning the `[` bracket. */
function emitDefaultsBlock(block: DefaultsStmt[], prefix: string): string {
  const maxTargetLen = Math.max(...block.map((d) => d.target.length));
  return block
    .map((d) => {
      const target = d.target.padEnd(maxTargetLen);
      const sorted = sortAttrs(d.attrs);
      const attrStr =
        sorted.length === 0
          ? "[]"
          : `[${sorted.map((a) => `${a.key} = ${quoteValue(a.value)}`).join(", ")}]`;
      return `${prefix}${target} ${attrStr}`;
    })
    .join("\n");
}

/** Emit a block of node declarations, aligning IDs and `=` signs within attrs. */
function emitNodeBlock(block: NodeDecl[], prefix: string): string {
  const maxIdLen = Math.max(...block.map((n) => emitId(n.id).length));
  const maxKeyLenByPos: number[] = [];
  for (const n of block) {
    sortAttrs(n.attrs).forEach((attr, i) => {
      maxKeyLenByPos[i] = Math.max(maxKeyLenByPos[i] ?? 0, attr.key.length);
    });
  }
  return block
    .map((n) => {
      const sorted = sortAttrs(n.attrs);
      if (sorted.length === 0) return `${prefix}${emitId(n.id)}`;
      const id = emitId(n.id).padEnd(maxIdLen);
      const parts = sorted.map(
        (attr, i) => `${attr.key.padEnd(maxKeyLenByPos[i])} = ${quoteValue(attr.value)}`,
      );
      return `${prefix}${id} [${parts.join(", ")}]`;
    })
    .join("\n");
}

/** Emit a block of edge chains, aligning `->` arrows, `[` brackets, and `=` signs. */
function emitEdgeBlock(block: EdgeChain[], prefix: string): string {
  // Compute max node-ID length at each arrow column.
  const maxNodeLen: number[] = [];
  for (const e of block) {
    e.ids.forEach((id, c) => {
      maxNodeLen[c] = Math.max(maxNodeLen[c] ?? 0, emitId(id).length);
    });
  }

  // Build a padded chain string (every node at column c padded to maxNodeLen[c]),
  // then trim trailing spaces so bare edges look clean.
  function buildChain(e: EdgeChain): string {
    return e.ids.map((id, c) => emitId(id).padEnd(maxNodeLen[c])).join(" -> ").trimEnd();
  }

  // Max total padded-chain width (for `[` bracket alignment).
  const maxChainWidth = Math.max(...block.map((e) => buildChain(e).length));

  // Compute max key length per attribute position (for `=` alignment).
  const maxKeyLenByPos: number[] = [];
  for (const e of block) {
    sortAttrs(e.attrs).forEach((attr, i) => {
      maxKeyLenByPos[i] = Math.max(maxKeyLenByPos[i] ?? 0, attr.key.length);
    });
  }

  return block
    .map((e) => {
      const chain = buildChain(e);
      const sorted = sortAttrs(e.attrs);
      if (sorted.length === 0) return `${prefix}${chain}`;
      const parts = sorted.map(
        (attr, i) => `${attr.key.padEnd(maxKeyLenByPos[i])} = ${quoteValue(attr.value)}`,
      );
      return `${prefix}${chain.padEnd(maxChainWidth)} [${parts.join(", ")}]`;
    })
    .join("\n");
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

  /** Emit all items in a section, splitting at blank lines into alignment blocks. */
  function joinAligned<T extends CstStmt>(items: T[], emitBlock: (b: T[]) => string): string {
    return splitBlocks(stmts, items).map(emitBlock).join("\n\n");
  }

  /** Emit subgraphs using blank-line detection but no cross-subgraph alignment. */
  function joinSubgraphs(items: Subgraph[]): string {
    const parts: string[] = [];
    for (let i = 0; i < items.length; i++) {
      if (i > 0) {
        parts.push(hadBlankLineBetween(stmts, items[i - 1], items[i]) ? "\n\n" : "\n");
      }
      parts.push(emitSubgraph(items[i], indent));
    }
    return parts.join("");
  }

  const sections: string[] = [];

  if (graphAttrs.length > 0) {
    sections.push(joinAligned(graphAttrs, (b) => emitGraphAttrBlock(b, prefix)));
  }
  if (graphDefaults.length > 0) {
    sections.push(joinAligned(graphDefaults, (b) => emitDefaultsBlock(b, prefix)));
  }
  if (nodeDefaults.length > 0) {
    sections.push(joinAligned(nodeDefaults, (b) => emitDefaultsBlock(b, prefix)));
  }
  if (edgeDefaults.length > 0) {
    sections.push(joinAligned(edgeDefaults, (b) => emitDefaultsBlock(b, prefix)));
  }
  if (nodes.length > 0) {
    sections.push(joinAligned(nodes, (b) => emitNodeBlock(b, prefix)));
  }
  if (edges.length > 0) {
    sections.push(joinAligned(edges, (b) => emitEdgeBlock(b, prefix)));
  }
  if (subgraphs.length > 0) {
    sections.push(joinSubgraphs(subgraphs));
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
