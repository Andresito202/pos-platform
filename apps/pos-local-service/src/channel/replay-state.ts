import type { LocalDatabase } from "@pos-platform/database-sqlite";

export interface ReplayAcceptance {
  readonly sessionId: string;
  readonly sequence: number;
  readonly expiresAt: string;
  readonly evaluatedAt: string;
}

export interface LocalChannelReplayStateStore {
  accept(input: ReplayAcceptance): void;
}

function assertAcceptance(input: ReplayAcceptance): void {
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

export class SqliteReplayStateStore implements LocalChannelReplayStateStore {
  constructor(
    private readonly database: LocalDatabase,
    private readonly maxSessions = 1_024,
  ) {
    if (!Number.isSafeInteger(maxSessions) || maxSessions <= 0) {
      throw new Error("max replay sessions must be a positive integer");
    }
  }

  accept(input: ReplayAcceptance): void {
    assertAcceptance(input);
    const transaction = this.database.native.transaction(() => {
      this.database.native.prepare(
        "DELETE FROM local_channel_replay_state WHERE expires_at <= ?",
      ).run(input.evaluatedAt);

      const current = this.database.native.prepare(
        "SELECT highest_sequence, expires_at FROM local_channel_replay_state WHERE session_id = ?",
      ).get(input.sessionId) as { highest_sequence: number; expires_at: string } | undefined;

      if (current === undefined) {
        const count = this.database.native.prepare(
          "SELECT count(*) AS count FROM local_channel_replay_state",
        ).get() as { count: number };
        if (count.count >= this.maxSessions) {
          throw new Error("local channel session capacity reached");
        }
      } else if (input.sequence <= current.highest_sequence) {
        throw new Error("local channel replay rejected");
      }

      const expiresAt = current === undefined || current.expires_at < input.expiresAt
        ? input.expiresAt
        : current.expires_at;
      this.database.native.prepare(`
        INSERT INTO local_channel_replay_state(session_id, highest_sequence, expires_at)
        VALUES (?, ?, ?)
        ON CONFLICT(session_id) DO UPDATE SET
          highest_sequence = excluded.highest_sequence,
          expires_at = excluded.expires_at
      `).run(input.sessionId, input.sequence, expiresAt);
    });
    transaction();
  }
}
