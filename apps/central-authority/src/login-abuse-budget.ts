import { createHash } from "node:crypto";
import { PlatformSecurityEventCode, uuidV7 } from "@pos-platform/contracts";
import type { Pool, PoolClient } from "@pos-platform/database-postgres";

const hash = (s: string) => createHash("sha256").update(s).digest("hex");

export type LoginAbuseScope = "GLOBAL" | "BUSINESS";

/**
 * Durable fixed-window login abuse budget on identity.security_events.
 * Reused by GLOBAL and BUSINESS browser login. Not for local offline cajero.
 */
export async function spendDurableLoginBudget(
  pool: Pool,
  scope: LoginAbuseScope,
  address: string,
  email: string,
  policy: { windowMs: number; maximumPerAddress: number; maximumPerAccount: number },
  client?: PoolClient,
): Promise<boolean> {
  if (![policy.windowMs, policy.maximumPerAddress, policy.maximumPerAccount].every(
    (n) => Number.isSafeInteger(n) && n > 0,
  ) || typeof address !== "string" || address.length > 256
    || typeof email !== "string" || email.length > 320) {
    throw Error(`${scope}_ADMIN_ABUSE_POLICY_REQUIRED`);
  }
  const keys = [
    { reason: `${scope}_LOGIN_ACCOUNT`, digest: hash(email.trim().toLowerCase()), max: policy.maximumPerAccount },
    { reason: `${scope}_LOGIN_ADDRESS`, digest: hash(address), max: policy.maximumPerAddress },
  ];
  const run = async (c: PoolClient) => {
    for (const k of keys) await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [k.reason + ":" + k.digest]);
    for (const k of keys) {
      const n = (await c.query(
        `SELECT count(*)::int AS n FROM identity.security_events WHERE event_code=$1 AND reason_code=$2
         AND evidence_checksum=$3 AND server_recorded_at>clock_timestamp()-$4*interval '1 millisecond'`,
        [PlatformSecurityEventCode.MFA_REQUIRED, k.reason, k.digest, policy.windowMs],
      )).rows[0].n;
      if (n >= k.max) return false;
    }
    for (const k of keys) {
      await c.query(
        `INSERT INTO identity.security_events(id,event_code,result,reason_code,evidence_checksum,correlation_id,occurred_at,server_recorded_at)
         VALUES($1,$2,'CHALLENGE_REQUIRED',$3,$4,$5,clock_timestamp(),clock_timestamp())`,
        [uuidV7(), PlatformSecurityEventCode.MFA_REQUIRED, k.reason, k.digest, uuidV7()],
      );
    }
    return true;
  };
  if (client) return run(client);
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const ok = await run(c);
    await c.query("COMMIT");
    return ok;
  } catch (e) {
    await c.query("ROLLBACK").catch(() => undefined);
    throw e;
  } finally {
    c.release();
  }
}
