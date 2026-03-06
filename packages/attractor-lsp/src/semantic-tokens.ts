import { lex } from "attractor";
import type { Token, TokenKind } from "attractor";

// ─── Legend ──────────────────────────────────────────────────────────────────

export const TOKEN_LEGEND = {
  tokenTypes: [
    "keyword",    // 0
    "namespace",  // 1
    "class",      // 2
    "operator",   // 3
    "property",   // 4
    "string",     // 5
    "number",     // 6
  ] as const,
  tokenModifiers: [
    "declaration", // bit 0
    "static",      // bit 1
    "abstract",    // bit 2
    "readonly",    // bit 3
  ] as const,
};

type TokenTypeName = (typeof TOKEN_LEGEND.tokenTypes)[number];
type TokenModifierName = (typeof TOKEN_LEGEND.tokenModifiers)[number];

// ─── Intermediate representation ──────────────────────────────────────────────

interface SemanticToken {
  line: number;    // 1-based (from lexer)
  column: number;  // 1-based (from lexer)
  length: number;
  type: number;
  modifiers: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function typeIndex(name: TokenTypeName): number {
  return TOKEN_LEGEND.tokenTypes.indexOf(name as never);
}

function modifierBit(name: TokenModifierName): number {
  const idx = TOKEN_LEGEND.tokenModifiers.indexOf(name as never);
  return idx >= 0 ? 1 << idx : 0;
}

function modBits(...names: TokenModifierName[]): number {
  return names.reduce((acc, n) => acc | modifierBit(n), 0);
}

// Source length of a token: STRING tokens store unquoted value, so add 2 for quotes.
function sourceLength(tok: Token): number {
  return tok.kind === "STRING" ? tok.value.length + 2 : tok.value.length;
}

// ─── Attribute context ────────────────────────────────────────────────────────

type AttrContext = "graph_attr" | "node_defaults" | "edge_defaults" | "node_decl" | "edge_chain";

function attrKeyModifier(ctx: AttrContext): number {
  if (ctx === "graph_attr") return modifierBit("static");
  if (ctx === "edge_defaults" || ctx === "edge_chain") return modifierBit("abstract");
  return 0; // node_defaults, node_decl — no modifier
}

// ─── Classifier ───────────────────────────────────────────────────────────────

export function computeSemanticTokens(text: string): number[] {
  let tokens: Token[];
  try {
    tokens = lex(text);
  } catch {
    return [];
  }

  const result: SemanticToken[] = [];
  let i = 0;

  function peek(offset = 0): Token | undefined {
    return tokens[i + offset];
  }

  function consume(): Token {
    return tokens[i++];
  }

  function emit(tok: Token, typeName: TokenTypeName, mods: number = 0): void {
    result.push({
      line: tok.line,
      column: tok.column,
      length: sourceLength(tok),
      type: typeIndex(typeName),
      modifiers: mods,
    });
  }

  // Lookahead: returns true if there is an ARROW before LBRACKET/RBRACE/SEMICOLON/EQUALS/EOF
  // starting at index `from`. LBRACKET terminates scan because an attr list on a node
  // comes before any arrow in that statement. EQUALS terminates scan because it means
  // the current identifier is an attribute key (e.g. `label="…"`), not an edge source.
  function hasArrowAhead(from: number): boolean {
    for (let j = from; j < tokens.length; j++) {
      const k = tokens[j].kind as TokenKind;
      if (k === "ARROW") return true;
      if (k === "LBRACKET" || k === "RBRACE" || k === "SEMICOLON" || k === "EQUALS" || k === "EOF") return false;
    }
    return false;
  }

  // Parse [key = value, ...] attribute list under the given attribute context.
  // Assumes i currently points to LBRACKET.
  function parseAttrList(attrCtx: AttrContext): void {
    consume(); // LBRACKET — not emitted

    while (i < tokens.length) {
      const tok = tokens[i];
      if (tok.kind === "EOF") return;
      if (tok.kind === "RBRACKET") {
        consume(); // not emitted
        return;
      }
      if (tok.kind === "COMMA" || tok.kind === "SEMICOLON") {
        consume(); // separator — not emitted
        continue;
      }

      // Attribute key: IDENTIFIER or STRING
      if (tok.kind === "IDENTIFIER" || tok.kind === "STRING") {
        const keyTok = consume();
        const keyName = keyTok.value;
        emit(keyTok, "property", attrKeyModifier(attrCtx));

        // Expect EQUALS
        if (tokens[i]?.kind === "EQUALS") {
          consume(); // EQUALS — not emitted

          const valTok = tokens[i];
          if (!valTok || valTok.kind === "RBRACKET" || valTok.kind === "EOF") continue;
          consume();

          if (keyName === "condition") {
            // Condition values get string + abstract regardless of token type
            emit(valTok, "string", modifierBit("abstract"));
          } else {
            switch (valTok.kind) {
              case "STRING":
                emit(valTok, "string");
                break;
              case "INTEGER":
              case "FLOAT":
                emit(valTok, "number");
                break;
              case "DURATION":
                emit(valTok, "number", modifierBit("readonly"));
                break;
              case "TRUE":
              case "FALSE":
                emit(valTok, "keyword");
                break;
              case "IDENTIFIER":
                // Unquoted identifier value (e.g. shape = Mdiamond) — treat as string
                emit(valTok, "string");
                break;
              default:
                // Unexpected token type for a value — skip
                break;
            }
          }
        }
        continue;
      }

      // Unexpected token in attr list — skip
      consume();
    }
  }

  // Parse body of a digraph or subgraph block.
  // Assumes i points to the first token inside {}.
  // Returns when RBRACE is encountered (consuming it) or EOF is reached.
  function parseBody(): void {
    while (i < tokens.length) {
      const tok = tokens[i];

      if (tok.kind === "EOF") return;
      if (tok.kind === "RBRACE") {
        consume(); // not emitted
        return;
      }
      if (tok.kind === "SEMICOLON" || tok.kind === "COMMA") {
        consume();
        continue;
      }

      // graph [...] — defaults for the graph itself
      if (tok.kind === "GRAPH") {
        consume();
        emit(tok, "keyword");
        while (tokens[i]?.kind === "LBRACKET") {
          parseAttrList("graph_attr");
        }
        continue;
      }

      // node [...] — defaults for all nodes
      if (tok.kind === "NODE") {
        consume();
        emit(tok, "keyword");
        while (tokens[i]?.kind === "LBRACKET") {
          parseAttrList("node_defaults");
        }
        continue;
      }

      // edge [...] — defaults for all edges
      if (tok.kind === "EDGE") {
        consume();
        emit(tok, "keyword");
        while (tokens[i]?.kind === "LBRACKET") {
          parseAttrList("edge_defaults");
        }
        continue;
      }

      // subgraph { ... } — optional name after keyword
      if (tok.kind === "SUBGRAPH") {
        consume();
        emit(tok, "keyword");
        // Optional subgraph name identifier (not emitted per spec — only digraph name is namespace)
        if (tokens[i]?.kind === "IDENTIFIER") {
          consume();
        }
        if (tokens[i]?.kind === "LBRACE") {
          consume(); // LBRACE — not emitted
          parseBody(); // recurse; exits on matching RBRACE
        }
        continue;
      }

      // IDENTIFIER or STRING at statement start — node decl or edge chain
      if (tok.kind === "IDENTIFIER" || tok.kind === "STRING") {
        const isEdge = hasArrowAhead(i + 1);

        if (isEdge) {
          // Edge chain: source -> target -> ... [attrs]
          consume();
          emit(tok, "class"); // source — class, no modifier (reference, not declaration)

          while (i < tokens.length) {
            const ct = tokens[i];
            if (ct.kind === "ARROW") {
              consume();
              emit(ct, "operator");
              // Target node identifier
              if (tokens[i]?.kind === "IDENTIFIER" || tokens[i]?.kind === "STRING") {
                const target = consume();
                emit(target, "class"); // target — class, no modifier
              }
            } else if (ct.kind === "LBRACKET") {
              parseAttrList("edge_chain");
            } else if (ct.kind === "SEMICOLON") {
              consume();
              break;
            } else if (ct.kind === "RBRACE" || ct.kind === "EOF") {
              break; // outer loop handles RBRACE
            } else {
              consume(); // skip unexpected
            }
          }
        } else {
          // Node declaration or bare key=value assignment (e.g. `label="Test"`).
          // If the next token is EQUALS, consume the = and its value so they are
          // not left in the stream to be misinterpreted as a subsequent edge source.
          consume();
          emit(tok, "class", modBits("declaration")); // node id — class + declaration

          if (tokens[i]?.kind === "EQUALS") {
            consume(); // EQUALS — not emitted
            const valTok = tokens[i];
            if (valTok && valTok.kind !== "RBRACE" && valTok.kind !== "SEMICOLON" && valTok.kind !== "EOF") {
              consume(); // value — not emitted
            }
          }

          while (tokens[i]?.kind === "LBRACKET") {
            parseAttrList("node_decl");
          }
          if (tokens[i]?.kind === "SEMICOLON") consume();
        }
        continue;
      }

      // Skip any other tokens at statement level
      consume();
    }
  }

  // Top-level: expect DIGRAPH keyword
  while (i < tokens.length && tokens[i].kind !== "EOF") {
    const tok = tokens[i];

    if (tok.kind === "DIGRAPH") {
      consume();
      emit(tok, "keyword", modifierBit("declaration"));

      // Optional graph name
      if (tokens[i]?.kind === "IDENTIFIER") {
        const nameTok = consume();
        emit(nameTok, "namespace", modifierBit("declaration"));
      }

      // Opening brace
      if (tokens[i]?.kind === "LBRACE") {
        consume(); // LBRACE — not emitted
        parseBody();
      }
      continue;
    }

    consume(); // skip unexpected top-level tokens
  }

  // Tokens are already in source order (lexer produces them left-to-right)
  // Delta-encode for LSP
  return deltaEncode(result);
}

// ─── Delta encoding ───────────────────────────────────────────────────────────

function deltaEncode(tokens: SemanticToken[]): number[] {
  const data: number[] = [];
  let prevLine = 0;  // 0-based
  let prevCol = 0;   // 0-based

  for (const tok of tokens) {
    const line0 = tok.line - 1;   // convert to 0-based
    const col0 = tok.column - 1;  // convert to 0-based

    const deltaLine = line0 - prevLine;
    const deltaCol = deltaLine === 0 ? col0 - prevCol : col0;

    data.push(deltaLine, deltaCol, tok.length, tok.type, tok.modifiers);

    prevLine = line0;
    prevCol = col0;
  }

  return data;
}
