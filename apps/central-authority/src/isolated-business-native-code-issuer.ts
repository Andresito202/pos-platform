import { createHash, randomBytes } from "node:crypto";
import type { Pool } from "pg";
import { IsolatedBusinessAuditSessionGuard } from "./isolated-business-audit-session-guard.js";
import type { ValidatedCommercialBinding } from "./commercial-binding-prerequisite.js";

/**
 * ISOLATED_VALIDATION only. Uses the existing locked BUSINESS session as the
 * authorization source. Issued codes are not access/refresh tokens, and the
 * caller must not expose them as production credentials.
 *
 * The fixture table is created explicitly by tests; no production migration
 * or automatic DDL is allowed here. Audit must use the provided transaction.
 */
export class IsolatedBusinessNativeCodeIssuer {
  private readonly guard: IsolatedBusinessAuditSessionGuard;
  constructor(private readonly pool: Pool) {
    this.guard = new IsolatedBusinessAuditSessionGuard(pool);
  }

  async issue(input: {
    readonly binding: ValidatedCommercialBinding;
    readonly clientId: string;
    readonly redirectUri: string;
    readonly codeChallenge: string;
    readonly state: string;
    readonly recordAudit: (transaction: import("pg").PoolClient) => Promise<void>;
  }): Promise<string | null> {
    if (!input?.binding?.identity || !input.binding.device ||
      input.binding.identity.tenantId !== input.binding.device.tenantId ||
      !/^[A-Za-z0-9._~-]{1,128}$/.test(input.clientId) ||
      !/^http:\/\/127\.0\.0\.1:[0-9]+\/callback$/.test(input.redirectUri) ||
      !/^[A-Za-z0-9_-]{43}$/.test(input.codeChallenge) ||
      !/^[A-Za-z0-9_-]{32,256}$/.test(input.state) ||
      typeof input.recordAudit !== "function") return null;
    const code = randomBytes(48).toString("base64url");
    const codeHash = createHash("sha256").update(code).digest("hex");
    const identity = input.binding.identity;
    const device = input.binding.device;
    const result = await this.guard.whileActive(identity, async client => {
      // Bound to server-verified identity and device. Both IDs remain durable
      // in the disposable DB for explicit exchange-time revalidation.
      await client.query(`INSERT INTO identity.native_authorization_code_validation
        (code_hash,client_id,redirect_uri,code_challenge,state,trusted_binding_id,
         session_id,device_id,tenant_id,issued_at,expires_at)
        SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,clock_timestamp(),
          LEAST(clock_timestamp()+interval '60 seconds',s.expires_at)
        FROM identity.sessions s
        JOIN identity.device_registry d ON d.device_id=$8
          AND d.tenant_id=s.tenant_id AND d.company_id=$12
          AND d.installation_id=$13 AND d.status='ACTIVE'
        JOIN identity.device_credentials dc ON dc.credential_id=$6
          AND dc.device_id=d.device_id AND dc.installation_id=d.installation_id
          AND dc.tenant_id=d.tenant_id AND dc.company_id=d.company_id
          AND dc.status='ACTIVE' AND dc.expires_at>clock_timestamp()
          AND dc.key_purpose='DEVICE_TRUST'
        WHERE s.id=$7 AND s.user_id=$10 AND s.tenant_id=$9
          AND s.tenant_membership_id=$11 AND s.revoked_at IS NULL
          AND s.expires_at>clock_timestamp()+interval '1 second'
        RETURNING code_hash`,[
        codeHash,input.clientId,input.redirectUri,input.codeChallenge,
        input.state,device.credentialId,identity.sessionId,device.deviceId,
        identity.tenantId,identity.userId,identity.tenantMembershipId,
        device.companyId,device.installationId,
      ]);
      // Check exactly one INSERT before committing audit. SQL errors abort.
      const found = await client.query<{n:number}>(
        "SELECT count(*)::int AS n FROM identity.native_authorization_code_validation WHERE code_hash=$1",
        [codeHash],
      );
      if (found.rows[0]?.n !== 1) throw new Error("NATIVE_CODE_ISSUANCE_SESSION_INVALID");
      await input.recordAudit(client);
      return code;
    });
    return result;
  }
}
