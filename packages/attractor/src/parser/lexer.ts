import type { Token, TokenKind } from "./tokens.js";

const KEYWORDS: Record<string, TokenKind> = {
  digraph: "DIGRAPH",
  graph: "GRAPH",
  node: "NODE",
  edge: "EDGE",
  subgraph: "SUBGRAPH",
  true: "TRUE",
  false: "FALSE",
};

const DURATION_SUFFIXES = ["ms", "s", "m", "h", "d"];

function stripComments(source: string): string {
  const result: string[] = [];
  let i = 0;
  while (i < source.length) {
    // Line comment
    if (source[i] === "/" && source[i + 1] === "/") {
      while (i < source.length && source[i] !== "\n") {
        result.push(" ");
        i++;
      }
    }
    // Block comment
    else if (source[i] === "/" && source[i + 1] === "*") {
      result.push(" ");
      result.push(" ");
      i += 2;
      while (i < source.length) {
        if (source[i] === "*" && source[i + 1] === "/") {
          result.push(" ");
          result.push(" ");
          i += 2;
          break;
        }
        result.push(source[i] === "\n" ? "\n" : " ");
        i++;
      }
    } else {
      result.push(source[i]);
      i++;
    }
  }
  return result.join("");
}

export function lex(source: string): Token[] {
  const stripped = stripComments(source);
  const tokens: Token[] = [];
  let i = 0;
  let line = 1;
  let lineStart = 0;

  function column(): number {
    return i - lineStart + 1;
  }

  function makeToken(kind: TokenKind, value: string, col: number): Token {
    return { kind, value, line, column: col };
  }

  while (i < stripped.length) {
    // Skip whitespace
    if (stripped[i] === "\n") {
      line++;
      lineStart = i + 1;
      i++;
      continue;
    }
    if (/\s/.test(stripped[i])) {
      i++;
      continue;
    }

    const col = column();
    const ch = stripped[i];

    // Arrow
    if (ch === "-" && stripped[i + 1] === ">") {
      tokens.push(makeToken("ARROW", "->", col));
      i += 2;
      continue;
    }

    // Single-char symbols
    if (ch === "{") { tokens.push(makeToken("LBRACE", "{", col)); i++; continue; }
    if (ch === "}") { tokens.push(makeToken("RBRACE", "}", col)); i++; continue; }
    if (ch === "[") { tokens.push(makeToken("LBRACKET", "[", col)); i++; continue; }
    if (ch === "]") { tokens.push(makeToken("RBRACKET", "]", col)); i++; continue; }
    if (ch === "=") { tokens.push(makeToken("EQUALS", "=", col)); i++; continue; }
    if (ch === ",") { tokens.push(makeToken("COMMA", ",", col)); i++; continue; }
    if (ch === ";") { tokens.push(makeToken("SEMICOLON", ";", col)); i++; continue; }

    // Quoted string
    if (ch === '"') {
      i++; // skip opening quote
      const chars: string[] = [];
      while (i < stripped.length && stripped[i] !== '"') {
        if (stripped[i] === "\n") {
          throw new Error(`Unterminated string at line ${line}, column ${col}`);
        }
        if (stripped[i] === "\\") {
          i++;
          const esc = stripped[i];
          if (esc === '"') chars.push('"');
          else if (esc === "\\") chars.push("\\");
          else if (esc === "n") chars.push("\n");
          else if (esc === "t") chars.push("\t");
          else chars.push(esc);
        } else {
          chars.push(stripped[i]);
        }
        i++;
      }
      if (i >= stripped.length) {
        throw new Error(`Unterminated string at line ${line}, column ${col}`);
      }
      i++; // skip closing quote
      // Check if the string value looks like a duration (e.g., "900s")
      const strVal = chars.join("");
      tokens.push(makeToken("STRING", strVal, col));
      continue;
    }

    // Numeric: optional minus, digits, optional decimal, optional duration suffix
    if (ch === "-" || /[0-9]/.test(ch)) {
      // Distinguish negative numbers from the ARROW or standalone minus
      // A minus followed by a digit is a negative number
      if (ch === "-" && (i + 1 >= stripped.length || !/[0-9]/.test(stripped[i + 1]))) {
        throw new Error(`Unexpected character '${ch}' at line ${line}, column ${col}`);
      }

      let numStr = "";
      if (ch === "-") {
        numStr += "-";
        i++;
      }
      while (i < stripped.length && /[0-9]/.test(stripped[i])) {
        numStr += stripped[i];
        i++;
      }

      let isFloat = false;
      if (i < stripped.length && stripped[i] === ".") {
        isFloat = true;
        numStr += ".";
        i++;
        while (i < stripped.length && /[0-9]/.test(stripped[i])) {
          numStr += stripped[i];
          i++;
        }
      }

      // Check for duration suffix (greedy: check "ms" first, then single-char)
      let suffix = "";
      if (i + 1 < stripped.length && stripped.slice(i, i + 2) === "ms") {
        suffix = "ms";
        i += 2;
      } else if (i < stripped.length && DURATION_SUFFIXES.includes(stripped[i])) {
        // Only consume as suffix if next char is not alphanumeric (identifier char)
        const next = stripped[i + 1];
        if (!next || !/[A-Za-z0-9_]/.test(next)) {
          suffix = stripped[i];
          i++;
        }
      }

      if (suffix) {
        tokens.push(makeToken("DURATION", numStr + suffix, col));
      } else if (isFloat) {
        tokens.push(makeToken("FLOAT", numStr, col));
      } else {
        tokens.push(makeToken("INTEGER", numStr, col));
      }
      continue;
    }

    // Identifier or keyword (allow dots in identifiers per spec simplification)
    if (/[A-Za-z_]/.test(ch)) {
      let id = "";
      while (i < stripped.length && /[A-Za-z0-9_.]/.test(stripped[i])) {
        id += stripped[i];
        i++;
      }
      const kind = KEYWORDS[id] ?? "IDENTIFIER";
      tokens.push(makeToken(kind, id, col));
      continue;
    }

    throw new Error(`Unexpected character '${ch}' at line ${line}, column ${col}`);
  }

  tokens.push({ kind: "EOF", value: "", line, column: column() });
  return tokens;
}
