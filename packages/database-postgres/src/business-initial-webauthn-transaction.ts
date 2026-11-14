import { createHash } from "node:crypto";
import type { Pool } from "pg";
import { PlatformSecurityEventCode, UuidSchema } from "@pos-platform/contracts";
import type { PasswordCredentialMatch } from "./password-credential-verification-repository.js";
import type { LockedPlatformWebAuthnChallenge } from "./platform-webauthn-challenge-repository.js";
import type { PlatformWebAuthnProofToCommit } from "./platform-webauthn-assertion-transaction.js";
import { PostgresPlatformWebAuthnMaterialRepository, type VerifiedPlatformWebAuthnMaterial } from "./platform-webauthn-material-repository.js";
import { PostgresPlatformSecurityEventRepository } from "./platform-security-event-repository.js";

/** Internal evidence only. Does not grant a session, tenant, role or SSA. */
export interface CommittedBusinessInitialMfa {
  readonly purpose: "BUSINESS_INITIAL_MFA"|"GLOBAL_INITIAL_MFA";
  readonly sessionId: null;
  readonly userId: string;
  readonly passwordCredentialId: string;
  readonly passwordCredentialVersion: string;
  readonly factorId: string;
  readonly challengeId: string;
  readonly correlationId: string;
  readonly verifiedAt: string;
}

/**
 * Central-only AUTHENTICATE transaction. Password match must come from the
 * trusted password verifier, never client JSON. The central binding enforces
 * that provenance. Does not extend the GLOBAL reauth/recovery transaction.
 */
export class PostgresBusinessInitialWebAuthnTransaction {
  constructor(private readonly pool: Pool,private readonly scope:"BUSINESS"|"GLOBAL"="BUSINESS") {
    if(!["BUSINESS","GLOBAL"].includes(scope))throw Error("INITIAL_MFA_SCOPE_REQUIRED");
  }

  async verifyAndCommit(
    input: {
      readonly passwordMatch: PasswordCredentialMatch;
      readonly challenge: string;
      readonly rpId: string;
      readonly expectedOrigin: string;
    },
    verify: (context: {
      readonly challenge: LockedPlatformWebAuthnChallenge;
      readonly material: VerifiedPlatformWebAuthnMaterial;
    }) => Promise<PlatformWebAuthnProofToCommit | null>,
  ): Promise<CommittedBusinessInitialMfa | null> {
    const userId = UuidSchema.parse(input.passwordMatch.userId);
    const credentialId = UuidSchema.parse(input.passwordMatch.credentialId);
    const credentialVersion = input.passwordMatch.credentialVersion;
    if (typeof credentialVersion !== "string" || !/^[1-9][0-9]*$/.test(credentialVersion)) return null;
    if (typeof input.challenge !== "string") return null;
    const raw = Buffer.from(input.challenge, "base64url");
    if (raw.length !== 32 || raw.toString("base64url") !== input.challenge) return null;
    const digest = createHash("sha256").update(input.challenge, "utf8").digest("hex");
    const client = await this.pool.connect();
    let begun = false;
    try {
      await client.query("BEGIN");
      begun = true;
      const found = await client.query<{ id: string; user_id: string; factor_id: string; correlation_id: string }>(
        `SELECT c.id::text, c.user_id::text, c.factor_id::text, c.correlation_id::text
           FROM identity.webauthn_challenges AS c
           JOIN identity.users AS u ON u.id=c.user_id AND u.status='ACTIVE'
           JOIN identity.user_credentials AS p ON p.user_id=u.id
            AND p.id=$3 AND p.version::text=$4
            AND p.credential_type='PASSWORD' AND p.status='ACTIVE' AND p.revoked_at IS NULL
            AND (p.locked_until IS NULL OR p.locked_until<=clock_timestamp())
           JOIN identity.mfa_factors AS f ON f.id=c.factor_id AND f.user_id=u.id
            AND f.factor_type='WEBAUTHN' AND f.status='ACTIVE'
            AND f.verified_at IS NOT NULL AND f.revoked_at IS NULL
          WHERE c.challenge_hash=$1 AND c.user_id=$2
            AND c.purpose=$7 AND c.session_id IS NULL
            AND c.consumed_at IS NULL AND c.expires_at>clock_timestamp()
            AND c.rp_id=$5 AND c.expected_origin=$6
          FOR UPDATE OF c FOR SHARE OF u, p, f`,
        [digest, userId, credentialId, credentialVersion, input.rpId, input.expectedOrigin,this.scope==="GLOBAL"?"GLOBAL_AUTHENTICATE":"AUTHENTICATE"],
      );
      const row = found.rows[0];
      if (!row) { await client.query("ROLLBACK"); begun = false; return null; }
      const materials = new PostgresPlatformWebAuthnMaterialRepository(this.pool);
      const material = await materials.findVerifiedMaterial(row.user_id, row.factor_id, client);
      if (!material) { await client.query("ROLLBACK"); begun = false; return null; }
      const proof = await verify({
        challenge: {
          challenge: input.challenge, userId: row.user_id, factorId: row.factor_id,
          sessionId: null, purpose: this.scope==="GLOBAL"?"GLOBAL_AUTHENTICATE":"AUTHENTICATE", rpId: input.rpId, expectedOrigin: input.expectedOrigin,
        }, material,
      });
      if (proof?.userVerified !== true || !Number.isSafeInteger(proof.newCounter)
        || proof.newCounter < 0 || proof.newCounter > 0xffffffff || typeof proof.credentialBackedUp !== "boolean") {
        await client.query("ROLLBACK"); begun = false; return null;
      }
      const advanced = await materials.advanceCounterCas(client, {
        userId: row.user_id, factorId: row.factor_id, materialId: material.materialId,
        expectedCounter: material.counter, expectedVersion: material.version,
        newCounter: proof.newCounter, backedUp: proof.credentialBackedUp,
      });
      if (!advanced) { await client.query("ROLLBACK"); begun = false; return null; }
      const consumed = await client.query<{ id: string }>(
        `UPDATE identity.webauthn_challenges SET consumed_at=clock_timestamp(),version=version+1
          WHERE id=$1 AND consumed_at IS NULL AND expires_at>clock_timestamp()
          RETURNING id::text`, [row.id],
      );
      if (consumed.rows.length !== 1) throw new Error("BUSINESS_INITIAL_MFA_CHALLENGE_EXPIRED_OR_CONSUMED");
      const clock = await client.query<{ at: Date }>("SELECT clock_timestamp() AS at");
      const at = clock.rows[0]?.at;
      if (!(at instanceof Date)) throw new Error("BUSINESS_INITIAL_MFA_CLOCK_MISSING");
      await new PostgresPlatformSecurityEventRepository(this.pool).append({
        user_id: row.user_id, session_id: null, tenant_id: null,
        event_code: PlatformSecurityEventCode.WEBAUTHN_ASSERTION_VERIFIED,
        result: "SUCCEEDED", reason_code: this.scope+"_INITIAL_MFA",
        correlation_id: row.correlation_id, occurred_at: at.toISOString(),
      }, client);
      await client.query("COMMIT");
      begun = false;
      return Object.freeze({
        purpose: this.scope==="GLOBAL"?"GLOBAL_INITIAL_MFA":"BUSINESS_INITIAL_MFA", sessionId: null, userId: row.user_id,
        passwordCredentialId: credentialId, passwordCredentialVersion: credentialVersion,
        factorId: row.factor_id, challengeId: row.id, correlationId: row.correlation_id, verifiedAt: at.toISOString(),
      });
    } catch (error) {
      if (begun) await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally { client.release(); }
  }
}
