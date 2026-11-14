import type { Pool } from "pg";
import { UuidSchema, isPlatformWebAuthnCredentialReference } from "@pos-platform/contracts";

export interface VerifiedPlatformWebAuthnFactorReference {
  readonly userId: string;
  readonly factorId: string;
  readonly secretReference: string;
}

/**
 * Resolves the sole canonical MFA factor registry; no alternative factor,
 * credential, user or session table is created.
 *
 * A reference is not proof of possession. The trusted server must resolve it
 * against an independently controlled and durable credential-material store
 * before performing WebAuthn signature and counter verification.
 */
export class PostgresPlatformWebAuthnFactorReferenceRepository {
  constructor(private readonly pool: Pool) {}

  async findVerifiedFactor(userId: string, factorId: string): Promise<VerifiedPlatformWebAuthnFactorReference | null> {
    const validUserId = UuidSchema.parse(userId);
    const validFactorId = UuidSchema.parse(factorId);
    const result = await this.pool.query<{
      user_id: string;
      factor_id: string;
      secret_reference: string | null;
    }>(
      `SELECT f.user_id::text, f.id::text AS factor_id, f.secret_reference
         FROM identity.mfa_factors AS f
         JOIN identity.users AS u ON u.id = f.user_id AND u.status = 'ACTIVE'
        WHERE f.id = $1 AND f.user_id = $2
          AND f.factor_type = 'WEBAUTHN' AND f.status = 'ACTIVE'
          AND f.verified_at IS NOT NULL AND f.revoked_at IS NULL
        LIMIT 1`,
      [validFactorId, validUserId],
    );
    const found = result.rows[0];
    if (!found || !isPlatformWebAuthnCredentialReference(found.secret_reference)) return null;
    return {
      userId: found.user_id,
      factorId: found.factor_id,
      secretReference: found.secret_reference,
    };
  }
}
