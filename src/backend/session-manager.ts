export class SessionManager {
  private sessions = new Map<string, string>();

  getSessionId(threadId: string): string | undefined {
    return this.sessions.get(threadId);
  }

  setSessionId(threadId: string, sessionId: string): void {
    this.sessions.set(threadId, sessionId);
  }

  snapshot(): Record<string, string> {
    return Object.fromEntries(this.sessions);
  }

  restore(data: Record<string, string>): void {
    this.sessions.clear();
    for (const [k, v] of Object.entries(data)) {
      this.sessions.set(k, v);
    }
  }

  clear(): void {
    this.sessions.clear();
  }
}
