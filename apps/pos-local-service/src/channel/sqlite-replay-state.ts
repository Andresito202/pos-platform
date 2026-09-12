import type { LocalDatabase } from "@pos-platform/database-sqlite";
import {
  assertAcceptance,
  type LocalChannelReplayStateStore,
  type ReplayAcceptance,
} from "@pos-platform/local-channel";

/**
 * Anti-replay persistente. Implementa el puerto que declara
 * `@pos-platform/local-channel` y es el único punto donde el estado del canal
 * toca la base local, que sólo el servicio escribe (`DEC-010` §118).
 */
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
