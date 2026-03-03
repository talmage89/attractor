import { lex } from "./lexer.js";
import type { Token, TokenKind } from "./tokens.js";
import type {
  Graph,
  GraphAttributes,
  GraphNode,
  Edge,
} from "../model/graph.js";

const DURATION_MS: Record<string, number> = {
  ms: 1,
  s: 1000,
  m: 60000,
  h: 3600000,
  d: 86400000,
};

function parseDurationToMs(value: string): number {
  for (const [suffix, multiplier] of Object.entries(DURATION_MS).sort(
    (a, b) => b[0].length - a[0].length
  )) {
    if (value.endsWith(suffix)) {
      const num = parseFloat(value.slice(0, -suffix.length));
      return num * multiplier;
    }
  }
  return parseFloat(value);
}

function deriveClassName(label: string): string {
  return label
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
}

function defaultGraphAttributes(): GraphAttributes {
  return {
    goal: "",
    label: "",
    modelStylesheet: "",
    defaultMaxRetry: 50,
    retryTarget: "",
    fallbackRetryTarget: "",
    defaultFidelity: "",
    raw: new Map(),
  };
}

function defaultGraphNode(id: string): GraphNode {
  return {
    id,
    label: id,
    shape: "box",
    type: "",
    prompt: "",
    maxRetries: 0,
    goalGate: false,
    retryTarget: "",
    fallbackRetryTarget: "",
    fidelity: "",
    threadId: "",
    className: "",
    timeout: null,
    llmModel: "",
    llmProvider: "",
    reasoningEffort: "high",
    autoStatus: false,
    allowPartial: false,
    raw: new Map(),
  };
}

function defaultEdge(from: string, to: string): Edge {
  return {
    from,
    to,
    label: "",
    condition: "",
    weight: 0,
    fidelity: "",
    threadId: "",
    loopRestart: false,
  };
}

class Parser {
  private tokens: Token[];
  private pos = 0;

  // Defaults stack: each frame holds nodeDefaults and edgeDefaults
  private defaultsStack: { node: Map<string, string>; edge: Map<string, string> }[] = [
    { node: new Map(), edge: new Map() },
  ];

  // Stack of derived class names from enclosing subgraphs
  private subgraphClassStack: string[] = [];

  private graph: Graph = {
    name: "",
    attributes: defaultGraphAttributes(),
    nodes: new Map(),
    edges: [],
  };

  constructor(source: string) {
    this.tokens = lex(source);
  }

  private peek(): Token {
    return this.tokens[this.pos];
  }

  private advance(): Token {
    return this.tokens[this.pos++];
  }

  private check(kind: TokenKind): boolean {
    return this.peek().kind === kind;
  }

  private match(kind: TokenKind): Token {
    const t = this.peek();
    if (t.kind !== kind) {
      throw new Error(
        `Parse error: expected ${kind} but got ${t.kind} ('${t.value}') at line ${t.line}, column ${t.column}`
      );
    }
    return this.advance();
  }

  private get nodeDefaults(): Map<string, string> {
    return this.defaultsStack[this.defaultsStack.length - 1].node;
  }

  private get edgeDefaults(): Map<string, string> {
    return this.defaultsStack[this.defaultsStack.length - 1].edge;
  }

  parse(): Graph {
    // Expect: digraph IDENTIFIER {
    if (!this.check("DIGRAPH")) {
      throw new Error(
        `Parse error: expected 'digraph' keyword but got '${this.peek().value}' at line ${this.peek().line}`
      );
    }
    this.advance(); // consume DIGRAPH
    const nameToken = this.match("IDENTIFIER");
    this.graph.name = nameToken.value;
    this.match("LBRACE");

    this.parseStatements();

    this.match("RBRACE");

    // Create implicit nodes for any edge endpoints not yet declared
    for (const edge of this.graph.edges) {
      if (!this.graph.nodes.has(edge.from)) {
        this.graph.nodes.set(edge.from, defaultGraphNode(edge.from));
      }
      if (!this.graph.nodes.has(edge.to)) {
        this.graph.nodes.set(edge.to, defaultGraphNode(edge.to));
      }
    }

    return this.graph;
  }

  private parseStatements(): void {
    while (!this.check("RBRACE") && !this.check("EOF")) {
      this.parseStatement();
    }
  }

  private parseStatement(): void {
    const t = this.peek();

    if (t.kind === "GRAPH") {
      this.advance();
      if (this.check("LBRACKET")) {
        const attrs = this.parseAttrBlock();
        this.applyGraphAttributes(attrs);
      }
      this.consumeOptionalSemicolon();
      return;
    }

    if (t.kind === "NODE") {
      this.advance();
      if (this.check("LBRACKET")) {
        const attrs = this.parseAttrBlock();
        for (const [k, v] of attrs) {
          this.nodeDefaults.set(k, v);
        }
      }
      this.consumeOptionalSemicolon();
      return;
    }

    if (t.kind === "EDGE") {
      this.advance();
      if (this.check("LBRACKET")) {
        const attrs = this.parseAttrBlock();
        for (const [k, v] of attrs) {
          this.edgeDefaults.set(k, v);
        }
      }
      this.consumeOptionalSemicolon();
      return;
    }

    if (t.kind === "SUBGRAPH") {
      this.parseSubgraph();
      return;
    }

    if (t.kind === "IDENTIFIER" || t.kind === "STRING") {
      // Could be: node stmt, edge chain, or top-level key=value graph attr
      // Look ahead to determine which. STRING is a quoted node ID (BUG-016).
      this.parseIdentifierStatement();
      return;
    }

    // Skip unknown tokens
    this.advance();
  }

  // Scan ahead (without consuming tokens) to find the top-level `label = ...`
  // assignment within the current subgraph body. Returns the label value or "".
  // Tracks brace and bracket depth so nested subgraphs and attr blocks are skipped.
  private findSubgraphLabel(): string {
    let braceDepth = 0;
    let bracketDepth = 0;
    let i = this.pos;
    while (i < this.tokens.length) {
      const t = this.tokens[i];
      if (t.kind === "LBRACE") { braceDepth++; }
      else if (t.kind === "RBRACE") {
        if (braceDepth === 0) break; // end of current subgraph
        braceDepth--;
      } else if (t.kind === "LBRACKET") { bracketDepth++; }
      else if (t.kind === "RBRACKET") { bracketDepth--; }
      else if (braceDepth === 0 && bracketDepth === 0 &&
               t.kind === "IDENTIFIER" && t.value === "label") {
        if (i + 1 < this.tokens.length && this.tokens[i + 1].kind === "EQUALS") {
          const valIdx = i + 2;
          if (valIdx < this.tokens.length) {
            const val = this.tokens[valIdx];
            if (val.kind === "STRING" || val.kind === "IDENTIFIER") return val.value;
          }
        }
      }
      i++;
    }
    return "";
  }

  private parseSubgraph(): void {
    this.match("SUBGRAPH");

    // Optional subgraph identifier
    if (this.check("IDENTIFIER")) {
      this.advance();
    }

    this.match("LBRACE");

    // Push a new defaults frame (inheriting parent defaults)
    const parentNode = new Map(this.nodeDefaults);
    const parentEdge = new Map(this.edgeDefaults);
    this.defaultsStack.push({ node: new Map(parentNode), edge: new Map(parentEdge) });

    const savedClass = [...this.subgraphClassStack];

    // Two-pass: scan ahead for label = ... so that nodes declared BEFORE the
    // label statement still receive the derived class (BUG-013).
    const subgraphLabel = this.findSubgraphLabel();
    if (subgraphLabel) {
      const derivedClass = deriveClassName(subgraphLabel);
      // Only push non-empty derived classes; an all-special-char label like "!!!"
      // produces "" which must not be appended to node.className (BUG-019).
      if (derivedClass) this.subgraphClassStack.push(derivedClass);
    }

    while (!this.check("RBRACE") && !this.check("EOF")) {
      const t = this.peek();

      // Consume top-level `label = ...` without re-pushing to the class stack
      // (class was already pushed by the lookahead above).
      if (t.kind === "IDENTIFIER" && t.value === "label") {
        const nextPos = this.pos + 1;
        if (nextPos < this.tokens.length && this.tokens[nextPos].kind === "EQUALS") {
          this.advance(); // consume "label"
          this.advance(); // consume "="
          this.parseValue();
          this.consumeOptionalSemicolon();
          continue;
        }
      }

      this.parseStatement();
    }

    this.match("RBRACE");
    this.defaultsStack.pop();
    this.subgraphClassStack.length = 0;
    for (const c of savedClass) this.subgraphClassStack.push(c);
  }

  // Accept either a bare IDENTIFIER or a quoted STRING as a node ID.
  private parseNodeId(): string {
    const t = this.peek();
    if (t.kind === "IDENTIFIER" || t.kind === "STRING") {
      this.advance();
      return t.value;
    }
    throw new Error(
      `Parse error: expected identifier at line ${t.line}, column ${t.column}`
    );
  }

  private parseIdentifierStatement(): void {
    // Gather identifier chain separated by ARROWs.
    // Both bare identifiers and quoted strings are accepted as node IDs.
    const chain: string[] = [this.parseNodeId()];

    while (this.check("ARROW")) {
      this.advance(); // consume ->
      // Next must be IDENTIFIER or STRING (quoted node ID)
      if (!this.check("IDENTIFIER") && !this.check("STRING")) {
        throw new Error(
          `Parse error: expected identifier after '->' at line ${this.peek().line}`
        );
      }
      chain.push(this.parseNodeId());
    }

    if (chain.length > 1) {
      // Edge chain — merge all consecutive attribute blocks (DOT allows multiple)
      const attrs = new Map<string, string>();
      while (this.check("LBRACKET")) {
        for (const [k, v] of this.parseAttrBlock()) attrs.set(k, v);
      }
      this.consumeOptionalSemicolon();

      for (let i = 0; i < chain.length - 1; i++) {
        const edge = this.buildEdge(chain[i], chain[i + 1], attrs);
        this.graph.edges.push(edge);
      }
      return;
    }

    // Single identifier — check for = (top-level graph attr) or [ (node)
    const id = chain[0];

    if (this.check("EQUALS")) {
      // Top-level graph attribute: key = value
      this.advance(); // consume =
      const value = this.parseValue();
      this.graph.attributes.raw.set(id, value);
      this.applyGraphAttributeKV(id, value);
      this.consumeOptionalSemicolon();
      return;
    }

    // Node declaration — merge all consecutive attribute blocks (DOT allows multiple)
    const attrs = new Map<string, string>();
    while (this.check("LBRACKET")) {
      for (const [k, v] of this.parseAttrBlock()) attrs.set(k, v);
    }
    this.consumeOptionalSemicolon();

    const node = this.buildNode(id, attrs);
    this.graph.nodes.set(id, node);
  }

  private parseAttrBlock(): Map<string, string> {
    this.match("LBRACKET");
    const attrs = new Map<string, string>();

    while (!this.check("RBRACKET") && !this.check("EOF")) {
      if (this.check("COMMA")) { this.advance(); continue; }
      if (this.check("SEMICOLON")) { this.advance(); continue; }

      const keyToken = this.peek();
      if (keyToken.kind !== "IDENTIFIER" && keyToken.kind !== "STRING") break;
      this.advance();
      const key = keyToken.value;

      if (this.check("EQUALS")) {
        this.advance(); // consume =
        const value = this.parseValue();
        attrs.set(key, value);
      } else {
        // Bare key (treated as flag, value = "true")
        attrs.set(key, "true");
      }

      if (this.check("COMMA")) this.advance();
    }

    this.match("RBRACKET");
    return attrs;
  }

  private parseValue(): string {
    const t = this.peek();

    if (t.kind === "STRING") {
      this.advance();
      return t.value;
    }
    if (t.kind === "INTEGER" || t.kind === "FLOAT" || t.kind === "DURATION") {
      this.advance();
      return t.value;
    }
    if (t.kind === "TRUE") {
      this.advance();
      return "true";
    }
    if (t.kind === "FALSE") {
      this.advance();
      return "false";
    }
    if (t.kind === "IDENTIFIER") {
      this.advance();
      return t.value;
    }

    throw new Error(
      `Parse error: unexpected token ${t.kind} ('${t.value}') at line ${t.line}, column ${t.column}`
    );
  }

  private consumeOptionalSemicolon(): void {
    if (this.check("SEMICOLON")) this.advance();
  }

  private buildNode(id: string, explicit: Map<string, string>): GraphNode {
    // Merge: nodeDefaults < explicit attrs
    const merged = new Map([...this.nodeDefaults, ...explicit]);

    const node = defaultGraphNode(id);

    // Apply merged attrs
    for (const [k, v] of merged) {
      this.applyNodeAttr(node, k, v);
    }

    // If no explicit label set, default to node id
    if (!merged.has("label")) {
      node.label = id;
    }

    // Append subgraph-derived class names
    for (const cls of this.subgraphClassStack) {
      if (!node.className) {
        node.className = cls;
      } else if (!node.className.split(",").map(s => s.trim()).includes(cls)) {
        node.className = node.className + "," + cls;
      }
    }

    return node;
  }

  private applyNodeAttr(node: GraphNode, key: string, value: string): void {
    node.raw.set(key, value);
    switch (key) {
      case "label": node.label = value; break;
      case "shape": node.shape = value; break;
      case "type": node.type = value; break;
      case "prompt": node.prompt = value; break;
      case "max_retries": node.maxRetries = parseInt(value, 10); break;
      case "goal_gate": node.goalGate = value === "true"; break;
      case "retry_target": node.retryTarget = value; break;
      case "fallback_retry_target": node.fallbackRetryTarget = value; break;
      case "fidelity": node.fidelity = value; break;
      case "thread_id": node.threadId = value; break;
      case "class": node.className = value; break;
      case "timeout": node.timeout = this.parseTimeout(value); break;
      case "llm_model": node.llmModel = value; break;
      case "llm_provider": node.llmProvider = value; break;
      case "reasoning_effort": node.reasoningEffort = value; break;
      case "auto_status": node.autoStatus = value === "true"; break;
      case "allow_partial": node.allowPartial = value === "true"; break;
    }
  }

  private parseTimeout(value: string): number | null {
    // Value may be a duration string like "900s", "15m", or just a number
    if (/^-?\d+(\.\d+)?(ms|s|m|h|d)$/.test(value)) {
      return parseDurationToMs(value);
    }
    // Plain number in milliseconds; return null for unparseable values so
    // callers can fall back to a safe default instead of receiving NaN
    const n = parseFloat(value);
    return Number.isFinite(n) ? n : null;
  }

  private buildEdge(from: string, to: string, explicit: Map<string, string>): Edge {
    const merged = new Map([...this.edgeDefaults, ...explicit]);
    const edge = defaultEdge(from, to);
    for (const [k, v] of merged) {
      this.applyEdgeAttr(edge, k, v);
    }
    return edge;
  }

  private applyEdgeAttr(edge: Edge, key: string, value: string): void {
    switch (key) {
      case "label": edge.label = value; break;
      case "condition": edge.condition = value; break;
      case "weight": edge.weight = parseInt(value, 10); break;
      case "fidelity": edge.fidelity = value; break;
      case "thread_id": edge.threadId = value; break;
      case "loop_restart": edge.loopRestart = value === "true"; break;
    }
  }

  private applyGraphAttributes(attrs: Map<string, string>): void {
    for (const [k, v] of attrs) {
      this.graph.attributes.raw.set(k, v);
      this.applyGraphAttributeKV(k, v);
    }
  }

  private applyGraphAttributeKV(key: string, value: string): void {
    switch (key) {
      case "goal": this.graph.attributes.goal = value; break;
      case "label": this.graph.attributes.label = value; break;
      case "model_stylesheet": this.graph.attributes.modelStylesheet = value; break;
      case "default_max_retry": {
        const parsed = parseInt(value, 10);
        // Only overwrite the default if the value is a valid integer; otherwise
        // keep the default (50) and let the validator emit a warning (BUG-018).
        if (!Number.isNaN(parsed)) {
          this.graph.attributes.defaultMaxRetry = parsed;
        }
        break;
      }
      case "retry_target": this.graph.attributes.retryTarget = value; break;
      case "fallback_retry_target": this.graph.attributes.fallbackRetryTarget = value; break;
      case "default_fidelity": this.graph.attributes.defaultFidelity = value; break;
    }
  }
}

export function parse(source: string): Graph {
  // Reject undirected graphs before lexing (avoids lexer errors on "--")
  const stripped = source
    .replace(/\/\/[^\n]*/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .trim();
  if (/^graph\b/i.test(stripped)) {
    throw new Error(
      "Parse error: expected 'digraph' keyword. Undirected graphs are not supported."
    );
  }
  const p = new Parser(source);
  return p.parse();
}
