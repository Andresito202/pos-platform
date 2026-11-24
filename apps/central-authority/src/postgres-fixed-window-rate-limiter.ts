/**
 * Multi-instance fixed-window abuse budget backed by PostgreSQL.
 * Atomic upsert — no Redis. Fail-closed on invalid keys or backend errors.
 */
export type PostgresRateLimitClient = {
  query: (
    text: string,
    values?: readonly unknown[],
  ) => Promise<{ rows: Array<{ count: number }> }>;
};

export class PostgresFixedWindowRateLimiter {
  constructor(
    private readonly db: PostgresRateLimitClient,
    private readonly maximum = 30,
    private readonly windowMs = 60_000,
  ) {
    if (![maximum, windowMs].every((n) => Number.isSafeInteger(n) && n > 0)) {
      throw new Error("RATE_LIMIT_POSTGRES_POLICY_REQUIRED");
    }
  }

  async allow(key: string, now = Date.now()): Promise<boolean> {
    if (!Number.isFinite(now) || typeof key !== "string" || !key || key.length > 512) {
      return false;
    }
    const resetAt = new Date(now + this.windowMs);
    const nowDate = new Date(now);
    try {
      const result = await this.db.query(
        `INSERT INTO platform.central_rate_limit_counters (bucket_key, count, reset_at, updated_at)
         VALUES ($1, 1, $2, $3)
         ON CONFLICT (bucket_key) DO UPDATE SET
           count = CASE
             WHEN platform.central_rate_limit_counters.reset_at <= $3 THEN 1
             ELSE platform.central_rate_limit_counters.count + 1
           END,
           reset_at = CASE
             WHEN platform.central_rate_limit_counters.reset_at <= $3 THEN $2
             ELSE platform.central_rate_limit_counters.reset_at
           END,
           updated_at = $3
         RETURNING count`,
        [key, resetAt, nowDate],
      );
      const count = result.rows[0]?.count ?? Number.NaN;
      if (!Number.isSafeInteger(count) || count < 1) return false;
      return count <= this.maximum;
    } catch {
      // Fail closed: a broken rate-limit backend must not widen abuse budgets.
      return false;
    }
  }
}
