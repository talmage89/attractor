export type TokenKind =
  | "DIGRAPH"
  | "GRAPH"
  | "NODE"
  | "EDGE"
  | "SUBGRAPH"
  | "TRUE"
  | "FALSE"
  | "IDENTIFIER"
  | "STRING"
  | "INTEGER"
  | "FLOAT"
  | "DURATION"
  | "LBRACE"
  | "RBRACE"
  | "LBRACKET"
  | "RBRACKET"
  | "EQUALS"
  | "COMMA"
  | "SEMICOLON"
  | "ARROW"
  | "EOF";

export interface Token {
  kind: TokenKind;
  value: string;
  line: number;
  column: number;
}
