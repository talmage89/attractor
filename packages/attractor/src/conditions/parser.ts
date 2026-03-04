export interface Clause {
  key: string;
  operator: "=" | "!=" | ">" | ">=" | "<" | "<=";
  value: string;
}

const OPS: { token: string; operator: Clause["operator"] }[] = [
  { token: ">=", operator: ">=" },
  { token: "<=", operator: "<=" },
  { token: "!=", operator: "!=" },
  { token: ">", operator: ">" },
  { token: "<", operator: "<" },
  { token: "=", operator: "=" },
];

export function parseCondition(source: string): Clause[] {
  if (source.trim() === "") return [];

  const clauses: Clause[] = [];
  const parts = source.split("&&");

  for (const part of parts) {
    const clause = part.trim();
    if (clause === "") continue;

    let matched = false;
    for (const { token, operator } of OPS) {
      const idx = clause.indexOf(token);
      if (idx !== -1) {
        const key = clause.slice(0, idx).trim();
        const value = clause.slice(idx + token.length).trim();
        if (key === "") throw new Error(`Invalid condition clause: "${clause}"`);
        clauses.push({ key, operator, value });
        matched = true;
        break;
      }
    }

    if (!matched) {
      // Bare key: truthy check
      const key = clause.trim();
      if (key === "") throw new Error(`Invalid condition clause: "${clause}"`);
      clauses.push({ key, operator: "!=", value: "" });
    }
  }

  return clauses;
}
