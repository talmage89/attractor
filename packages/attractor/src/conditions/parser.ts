export interface Clause {
  key: string;
  operator: "=" | "!=";
  value: string;
}

export function parseCondition(source: string): Clause[] {
  if (source.trim() === "") return [];

  const clauses: Clause[] = [];
  const parts = source.split("&&");

  for (const part of parts) {
    const clause = part.trim();
    if (clause === "") continue;

    const neqIdx = clause.indexOf("!=");
    if (neqIdx !== -1) {
      const key = clause.slice(0, neqIdx).trim();
      const value = clause.slice(neqIdx + 2).trim();
      if (key === "") throw new Error(`Invalid condition clause: "${clause}"`);
      clauses.push({ key, operator: "!=", value });
      continue;
    }

    const eqIdx = clause.indexOf("=");
    if (eqIdx !== -1) {
      const key = clause.slice(0, eqIdx).trim();
      const value = clause.slice(eqIdx + 1).trim();
      if (key === "") throw new Error(`Invalid condition clause: "${clause}"`);
      clauses.push({ key, operator: "=", value });
      continue;
    }

    // Bare key: truthy check
    const key = clause.trim();
    if (key === "") throw new Error(`Invalid condition clause: "${clause}"`);
    clauses.push({ key, operator: "!=", value: "" });
  }

  return clauses;
}
