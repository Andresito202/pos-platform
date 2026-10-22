import { createHash } from "node:crypto";
import type { Pool } from "@pos-platform/database-postgres";
import type { AtomicNativeCodeConsumer, StoredNativeAuthorizationGrant } from "./native-authorization-code-exchange.js";

/**
 * ISOLATED VALIDATION ONLY. A dedicated owner/DDL review is required before
 * any production adoption. No schema is created automatically.
 */
export class IsolatedPostgresNativeCodeConsumer<Binding> implements AtomicNativeCodeConsumer<Binding> {
  readonly durabilityPolicyReference = "ISOLATED_NATIVE_CODE_VALIDATION";
  constructor(
    private readonly pool: Pool,
    private readonly resolveTrustedBinding: (opaqueBindingId: string) => Promise<Binding | null>,
  ) {
    const url = new URL(pool.options.connectionString ?? "invalid:");
    if (!["localhost", "127.0.0.1"].includes(url.hostname) || url.port !== "55433")
      throw new Error("NATIVE_CODE_ISOLATED_POSTGRES_REQUIRED");
  }

  async consume(code: string, verify: (grant: StoredNativeAuthorizationGrant) => boolean): Promise<Binding | null> {
    if (!/^[A-Za-z0-9._~-]{16,512}$/.test(code) || typeof verify !== "function") return null;
    const client = await this.pool.connect();
    let transaction = false;
    let bindingId: string | null = null;
    try {
      await client.query("BEGIN");
      transaction = true;
      const database = await client.query<{ approved: boolean }>(
        "SELECT current_database() ~ '^pos_native_code_test_[0-9a-f]{16}$' AS approved",
      );
      if (database.rows[0]?.approved !== true) throw new Error("NATIVE_CODE_ISOLATED_DATABASE_REQUIRED");
      const hash = createHash("sha256").update(code, "utf8").digest("hex");
      const result = await client.query<{
        client_id: string; redirect_uri: string; code_challenge: string;
        state: string; trusted_binding_id: string; valid: boolean;
      }>(`SELECT client_id,redirect_uri,code_challenge,state,trusted_binding_id,
          (expires_at > clock_timestamp() AND consumed_at IS NULL) AS valid
          FROM identity.native_authorization_code_validation WHERE code_hash=$1 FOR UPDATE`, [hash]);
      const record = result.rows[0];
      if (record?.valid) {
        // Burning occurs even for mismatched PKCE/client/state.
        await client.query(`UPDATE identity.native_authorization_code_validation
          SET consumed_at=clock_timestamp() WHERE code_hash=$1 AND consumed_at IS NULL`, [hash]);
        if (verify({clientId:record.client_id,redirectUri:record.redirect_uri,
          codeChallenge:record.code_challenge,state:record.state})) bindingId=record.trusted_binding_id;
      }
      await client.query("COMMIT");
      transaction = false;
    } catch (error) {
      if (transaction) await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
    // Never issue a binding before a durable commit; this is an isolated
    // in-process resolver, not a transport or production token issuer.
    return bindingId ? this.resolveTrustedBinding(bindingId) : null;
  }
}
