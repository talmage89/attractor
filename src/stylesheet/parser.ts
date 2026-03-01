export type StyleSelector =
  | { type: "universal" }
  | { type: "class"; className: string }
  | { type: "id"; nodeId: string };

export interface StyleRule {
  selector: StyleSelector;
  declarations: Map<string, string>;
}

const KNOWN_PROPERTIES = new Set(["llm_model", "llm_provider", "reasoning_effort"]);

export function parseStylesheet(source: string): StyleRule[] {
  const rules: StyleRule[] = [];
  let pos = 0;

  function skipWhitespace(): void {
    while (pos < source.length && /\s/.test(source[pos])) pos++;
  }

  function readIdentifier(): string {
    const start = pos;
    while (pos < source.length && /[\w.-]/.test(source[pos])) pos++;
    return source.slice(start, pos);
  }

  while (pos < source.length) {
    skipWhitespace();
    if (pos >= source.length) break;

    // Read selector
    let selector: StyleSelector;
    const ch = source[pos];
    if (ch === "*") {
      pos++;
      selector = { type: "universal" };
    } else if (ch === "#") {
      pos++;
      const id = readIdentifier();
      if (!id) throw new Error(`Expected identifier after '#' at position ${pos}`);
      selector = { type: "id", nodeId: id };
    } else if (ch === ".") {
      pos++;
      const cls = readIdentifier();
      if (!cls) throw new Error(`Expected identifier after '.' at position ${pos}`);
      selector = { type: "class", className: cls };
    } else {
      throw new Error(`Unexpected character '${ch}' at position ${pos}`);
    }

    skipWhitespace();
    if (pos >= source.length || source[pos] !== "{") {
      throw new Error(`Expected '{' after selector at position ${pos}`);
    }
    pos++; // consume '{'

    const declarations = new Map<string, string>();

    // Read declarations until '}'
    while (pos < source.length && source[pos] !== "}") {
      skipWhitespace();
      if (pos >= source.length) throw new Error("Unterminated stylesheet block");
      if (source[pos] === "}") break;

      // Read property name
      const propStart = pos;
      while (pos < source.length && source[pos] !== ":" && source[pos] !== "}" && !/\s/.test(source[pos])) {
        pos++;
      }
      const property = source.slice(propStart, pos).trim();

      skipWhitespace();
      if (pos >= source.length || source[pos] !== ":") {
        throw new Error(`Expected ':' after property '${property}' at position ${pos}`);
      }
      pos++; // consume ':'

      // Read value until ';' or '}'
      const valueStart = pos;
      while (pos < source.length && source[pos] !== ";" && source[pos] !== "}") {
        pos++;
      }
      const value = source.slice(valueStart, pos).trim();

      if (source[pos] === ";") pos++; // consume optional ';'

      if (property && KNOWN_PROPERTIES.has(property)) {
        declarations.set(property, value);
      }
      // Unrecognized properties are silently ignored
    }

    if (pos >= source.length) throw new Error("Unterminated stylesheet block");
    pos++; // consume '}'

    rules.push({ selector, declarations });
  }

  return rules;
}
