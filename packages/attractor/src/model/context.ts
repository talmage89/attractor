export class Context {
  private values = new Map<string, unknown>();

  set(key: string, value: unknown): void {
    this.values.set(key, value);
  }

  get(key: string): unknown | undefined {
    return this.values.get(key);
  }

  getString(key: string, defaultValue = ""): string {
    const val = this.values.get(key);
    if (val === undefined) return defaultValue;
    return String(val);
  }

  has(key: string): boolean {
    return this.values.has(key);
  }

  keys(): string[] {
    return Array.from(this.values.keys());
  }

  snapshot(): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [k, v] of this.values) {
      result[k] = v;
    }
    return result;
  }

  clone(): Context {
    const copy = new Context();
    for (const [k, v] of this.values) {
      copy.values.set(k, v);
    }
    return copy;
  }

  applyUpdates(updates: Record<string, unknown>): void {
    for (const [k, v] of Object.entries(updates)) {
      this.values.set(k, v);
    }
  }
}
