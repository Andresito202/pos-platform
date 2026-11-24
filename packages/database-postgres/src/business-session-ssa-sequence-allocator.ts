import type { Pool } from "pg";
import { UuidSchema } from "@pos-platform/contracts";
import {
  BUSINESS_SSA_ELIGIBILITY_SQL,
  type BusinessSessionEligibilityInput,
  type EligibleBusinessSessionCandidate,
} from "./business-session-ssa-eligibility-repository.js";

/** A reserved watermark is not a signed SSA nor evidence of authentication. */
export interface ReservedBusinessSsaSequence {
  readonly eligibleScope: EligibleBusinessSessionCandidate;
  readonly sequence: number;
}

/**
 * INTERNAL central-only durable SSA watermark allocator.
 *
 * This is a privileged DB operation, never an HTTP handler. Its input IDs MUST
 * come from a central session-proof verifier AND a device proof-of-possession
 * verifier. Querying their UUIDs here is NOT authentication. The allocator
 * rechecks the same persisted eligibility predicate in its write transaction
 * and holds row share locks through sequence reservation.
 *
 * It commits the counter BEFORE an SSA may be signed. A later signing failure
 * leaves a harmless gap: signed SSAs can never reuse a committed sequence.
 * Refresh/relogin cannot reset the counter since its PK is the RECEIVER
 * binding (user, installation, device), not identity.sessions.id.
 */
export class PostgresBusinessSsaSequenceAllocator {
  constructor(
    private readonly pool: Pool,
    private readonly maximumReauthenticationAgeMs: number,
  ) {
    if (!Number.isSafeInteger(maximumReauthenticationAgeMs) ||
        maximumReauthenticationAgeMs <= 0) {
      throw new Error("SSA_SEQUENCE_REAUTH_POLICY_INVALID");
    }
  }

  async reserveForVerifiedProof(input: BusinessSessionEligibilityInput): Promise<ReservedBusinessSsaSequence | null> {
    const sessionId = UuidSchema.parse(input.sessionId);
    const deviceId = UuidSchema.parse(input.deviceId);
    const installationId = UuidSchema.parse(input.installationId);
    const client = await this.pool.connect();
    let begun = false;
    try {
      // READ COMMITTED permits concurrent UPSERTs to serialize on the
      // counter row. Requisite identity/scope rows are share-locked below.
      await client.query("BEGIN ISOLATION LEVEL READ COMMITTED");
      begun = true;
      const scoped = await client.query<{ tenant_id: string }>(
        "SELECT tenant_id::text AS tenant_id FROM identity.sessions WHERE id=$1 AND tenant_id IS NOT NULL FOR SHARE",
        [sessionId],
      );
      const tenantId = scoped.rows[0]?.tenant_id;
      if (!tenantId) {
        await client.query("ROLLBACK"); begun = false;
        return null;
      }
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [UuidSchema.parse(tenantId)]);

      // Mandatory DB revalidation, including MFA, active tenant/membership,
      // company and active device credential. These locks protect the
      // database eligibility state from concurrent revocation until COMMIT.
      const result = await client.query<{
        session_id: string;
        user_id: string;
        tenant_id: string;
        tenant_membership_id: string;
        company_id: string;
        device_id: string;
        installation_id: string;
        session_expires_at: Date;
        credential_expires_at: Date;
      }>(
        BUSINESS_SSA_ELIGIBILITY_SQL + "\nFOR SHARE OF s, u, tm, t, d, company, dc",
        [sessionId, deviceId, installationId, this.maximumReauthenticationAgeMs],
      );
      const row = result.rows[0];
      if (!row) {
        await client.query("ROLLBACK"); begun = false;
        return null;
      }
      if (!(row.session_expires_at instanceof Date) ||
          !(row.credential_expires_at instanceof Date) ||
          !Number.isFinite(row.session_expires_at.getTime()) ||
          !Number.isFinite(row.credential_expires_at.getTime()) ||
          row.session_expires_at.getTime() <= Date.now() ||
          row.credential_expires_at.getTime() <= Date.now()) {
        throw new Error("SSA_SEQUENCE_ELIGIBILITY_EXPIRED");
      }
      // An EXISTS subquery in the shared eligibility SELECT does not lock
      // the MFA factor. Lock an active verified factor explicitly so it
      // cannot be revoked between eligibility and watermark COMMIT.
      const factor = await client.query<{ id: string }>(
        [
          "SELECT id::text AS id FROM identity.mfa_factors",
          "WHERE user_id=$1 AND status='ACTIVE'",
          "  AND verified_at IS NOT NULL AND revoked_at IS NULL",
          "ORDER BY id LIMIT 1 FOR SHARE",
        ].join("\n"),
        [row.user_id],
      );
      if (!factor.rows[0]) {
        await client.query("ROLLBACK"); begun = false;
        return null;
      }
      const scope: EligibleBusinessSessionCandidate = {
        sessionId: row.session_id,
        userId: row.user_id,
        tenantId: row.tenant_id,
        tenantMembershipId: row.tenant_membership_id,
        companyId: row.company_id,
        deviceId: row.device_id,
        installationId: row.installation_id,
        sessionExpiresAt: row.session_expires_at.toISOString(),
        deviceCredentialExpiresAt: row.credential_expires_at.toISOString(),
      };

      const reserved = await client.query<{ sequence: string }>(
        [
          "INSERT INTO identity.session_assertion_sequences",
          "  (user_id, installation_id, device_id, last_issued_sequence)",
          "VALUES ($1, $2, $3, 1)",
          "ON CONFLICT ON CONSTRAINT session_assertion_sequences_pk",
          "DO UPDATE SET",
          "  last_issued_sequence = identity.session_assertion_sequences.last_issued_sequence + 1,",
          "  updated_at = clock_timestamp()",
          "WHERE identity.session_assertion_sequences.last_issued_sequence < 9007199254740991",
          "RETURNING last_issued_sequence::text AS sequence",
        ].join("\n"),
        [scope.userId, scope.installationId, scope.deviceId],
      );
      const raw = reserved.rows[0]?.sequence;
      const sequence = Number(raw);
      if (typeof raw !== "string" || !Number.isSafeInteger(sequence) || sequence <= 0) {
        throw new Error("SSA_SEQUENCE_EXHAUSTED_OR_INVALID");
      }
      // If a session expired during a contested reservation, fail closed.
      if (Date.now() >= Date.parse(scope.sessionExpiresAt) ||
          Date.now() >= Date.parse(scope.deviceCredentialExpiresAt)) {
        throw new Error("SSA_SEQUENCE_ELIGIBILITY_EXPIRED");
      }

      await client.query("COMMIT");
      begun = false;
      return { eligibleScope: scope, sequence };
    } catch (error) {
      if (begun) await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}
