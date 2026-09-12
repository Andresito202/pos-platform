/**
 * Anti-replay del canal: el puerto y la implementación en memoria.
 *
 * La implementación sobre SQLite **no vive aquí**, y es deliberado: obligaría a
 * este paquete a depender de `@pos-platform/database-sqlite`, que la capa
 * `transport` no admite y que arrastraría `better-sqlite3` hasta el proceso de
 * Electron. La persistencia del anti-replay es del servicio —el único proceso
 * escritor, `DEC-010` §118— y vive en
 * `apps/pos-local-service/src/channel/sqlite-replay-state.ts`.
 */
export interface ReplayAcceptance {
  readonly sessionId: string;
  readonly sequence: number;
  readonly expiresAt: string;
  readonly evaluatedAt: string;
}

export interface LocalChannelReplayStateStore {
  accept(input: ReplayAcceptance): void;
}

export function assertAcceptance(input: ReplayAcceptance): void {
  if (!Number.isSafeInteger(input.sequence) || input.sequence <= 0) {
    throw new Error("local channel sequence must be a positive safe integer");
  }
  const expiresAt = Date.parse(input.expiresAt);
  const evaluatedAt = Date.parse(input.evaluatedAt);
  if (!Number.isFinite(expiresAt) || !Number.isFinite(evaluatedAt) || expiresAt <= evaluatedAt) {
    throw new Error("local channel replay expiry is invalid");
  }
}

export class InMemoryReplayStateStore implements LocalChannelReplayStateStore {
  private readonly sessions = new Map<string, { highestSequence: number; expiresAt: number }>();

  constructor(private readonly maxSessions = 1_024) {
    if (!Number.isSafeInteger(maxSessions) || maxSessions <= 0) {
      throw new Error("max replay sessions must be a positive integer");
    }
  }

  accept(input: ReplayAcceptance): void {
    assertAcceptance(input);
    const now = Date.parse(input.evaluatedAt);
    for (const [sessionId, state] of this.sessions) {
      if (state.expiresAt <= now) this.sessions.delete(sessionId);
    }

    const current = this.sessions.get(input.sessionId);
    if (current === undefined && this.sessions.size >= this.maxSessions) {
      throw new Error("local channel session capacity reached");
    }
    if (current !== undefined && input.sequence <= current.highestSequence) {
      throw new Error("local channel replay rejected");
    }

    this.sessions.set(input.sessionId, {
      highestSequence: input.sequence,
      expiresAt: Math.max(current?.expiresAt ?? 0, Date.parse(input.expiresAt)),
    });
  }
}
