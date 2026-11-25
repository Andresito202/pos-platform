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

/** Non-distributed backends are restricted to explicitly local development/testing. */
export function allowsNonPostgresRateLimit(nodeEnv: string | undefined, environment: string | undefined): boolean {
  return (nodeEnv === "test" || nodeEnv === "development") && environment === "LOCAL";
}

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

  async allow(key: string): Promise<boolean> {
    if (typeof key !== "string" || !key.trim() || key.length > 512) {
      return false;
    }
    try {
      const result = await this.db.query(
        `INSERT INTO platform.central_rate_limit_counters (bucket_key, count, reset_at, updated_at)
         VALUES ($1, 1, statement_timestamp() + ($2::bigint * interval '1 millisecond'), statement_timestamp())
         ON CONFLICT (bucket_key) DO UPDATE SET
           count = CASE
             WHEN platform.central_rate_limit_counters.reset_at <= statement_timestamp() THEN 1
             ELSE platform.central_rate_limit_counters.count + 1
           END,
           reset_at = CASE
             WHEN platform.central_rate_limit_counters.reset_at <= statement_timestamp() THEN EXCLUDED.reset_at
             ELSE platform.central_rate_limit_counters.reset_at
           END,
           updated_at = GREATEST(platform.central_rate_limit_counters.updated_at, statement_timestamp())
         RETURNING count`,
        [key, this.windowMs],
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
