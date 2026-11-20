import type { Pool, PoolClient } from "pg";
import {
  UuidSchema,
  isPlatformWebAuthnCredentialReference,
  type PlatformWebAuthnCredentialMaterialV1,
} from "@pos-platform/contracts";

export interface VerifiedPlatformWebAuthnMaterial extends PlatformWebAuthnCredentialMaterialV1 {
  readonly materialId: string;
  readonly factorId: string;
  readonly userId: string;
  readonly backupEligible: boolean;
  readonly backedUp: boolean;
  readonly version: number;
}

export interface AdvancePlatformWebAuthnCounter {
  readonly userId: string;
  readonly factorId: string;
  readonly materialId: string;
  readonly expectedCounter: number;
  readonly newCounter: number;
  readonly expectedVersion: number;
  readonly backedUp: boolean;
}

function counterValid(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0 && value <= 0xffffffff;
}

/**
 * Central-only PUBLIC credential-material store for the existing canonical MFA
 * factor. Requires 010; not a user/factor/session authority.
 *
 * Never trust material from the browser. A caller must first validate an
 * actual WebAuthn signature and run advanceCounterCas with a PoolClient inside
 * the SAME transaction that consumes the challenge and appends audit.
 */
export class PostgresPlatformWebAuthnMaterialRepository {
  constructor(private readonly pool: Pool) {}

  async findVerifiedMaterial(userId: string, factorId: string, transaction?: PoolClient): Promise<VerifiedPlatformWebAuthnMaterial | null> {
    const validUserId = UuidSchema.parse(userId);
    const validFactorId = UuidSchema.parse(factorId);
    const result = await (transaction ?? this.pool).query<{
      material_id: string; user_id: string; factor_id: string;
      secret_reference: string; credential_id: string; public_key_cose_base64url: string;
      counter: string; version: string; backup_eligible: boolean; backed_up: boolean;
    }>(
      `SELECT m.id::text AS material_id, f.user_id::text, f.id::text AS factor_id,
              f.secret_reference, m.credential_id, m.public_key_cose_base64url,
              m.counter::text, m.version::text, m.backup_eligible, m.backed_up
         FROM identity.webauthn_credential_material AS m
         JOIN identity.mfa_factors AS f ON f.id = m.factor_id
         JOIN identity.users AS u ON u.id = f.user_id AND u.status = 'ACTIVE'
        WHERE f.id = $1 AND f.user_id = $2 AND f.factor_type = 'WEBAUTHN'
          AND f.status = 'ACTIVE' AND f.verified_at IS NOT NULL AND f.revoked_at IS NULL
          AND f.secret_reference = 'webauthn:v1:' || m.id::text
        LIMIT 1${transaction ? " FOR UPDATE OF m" : ""}`,
      [validFactorId, validUserId],
    );
    const row = result.rows[0];
    if (!row || !isPlatformWebAuthnCredentialReference(row.secret_reference)) return null;
    const counter = Number(row.counter), version = Number(row.version);
    if (!counterValid(counter) || !Number.isSafeInteger(version) || version < 1) return null;
    return {
      schemaVersion: 1, userId: row.user_id, factorId: row.factor_id,
      materialId: row.material_id, secretReference: row.secret_reference,
      credentialId: row.credential_id, publicKeyCoseBase64url: row.public_key_cose_base64url,
      counter, version, backupEligible: row.backup_eligible, backedUp: row.backed_up,
    };
  }

  /**
   * Compare-and-swap of an authenticated WebAuthn response counter.
   * The caller OWNS the transaction; false means the caller MUST roll back
   * challenge consumption and authentication/audit side effects.
   *
   * Counterless credentials may use zero -> zero with version increment.
   * Positive counters must advance strictly to detect counter replay.
   */
  async advanceCounterCas(client: PoolClient, input: AdvancePlatformWebAuthnCounter): Promise<boolean> {
    const userId = UuidSchema.parse(input.userId);
    const factorId = UuidSchema.parse(input.factorId);
    const materialId = UuidSchema.parse(input.materialId);
    if (!counterValid(input.expectedCounter) || !counterValid(input.newCounter) ||
        !Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 1 ||
        typeof input.backedUp !== "boolean") {
      throw new Error("PLATFORM_WEBAUTHN_COUNTER_POLICY_INVALID");
    }
    if (input.expectedCounter === 0 ? input.newCounter < 0
      : input.newCounter <= input.expectedCounter) return false;

    const updated = await client.query<{ id: string }>(
      `UPDATE identity.webauthn_credential_material AS m
          SET counter = $4, backed_up = $6, last_used_at = clock_timestamp(),
              version = version + 1
        WHERE m.id = $1 AND m.factor_id = $2
          AND m.counter = $3 AND m.version = $5
          AND (NOT $6::boolean OR m.backup_eligible)
          AND EXISTS (
            SELECT 1 FROM identity.mfa_factors AS f
            JOIN identity.users AS u ON u.id = f.user_id AND u.status = 'ACTIVE'
             WHERE f.id = m.factor_id AND f.user_id = $7
               AND f.factor_type = 'WEBAUTHN' AND f.status = 'ACTIVE'
               AND f.verified_at IS NOT NULL AND f.revoked_at IS NULL
               AND f.secret_reference = 'webauthn:v1:' || m.id::text
          )
        RETURNING m.id::text`,
      [materialId, factorId, input.expectedCounter, input.newCounter,
       input.expectedVersion, input.backedUp, userId],
    );
    return updated.rows.length === 1;
  }
}
