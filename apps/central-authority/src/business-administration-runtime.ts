import { lstatSync, readFileSync } from "node:fs";
import { isAbsolute } from "node:path";
import { BusinessAdministrationProvisionSchema, isSupportedPlatformPasswordVerifier, validateCommercialHttpsOrigin } from "@pos-platform/contracts";
import type { Pool } from "@pos-platform/database-postgres";
import { createBusinessAdministrationHandler } from "./business-administration-http.js";
import { createGlobalAdministrationAssets } from "./global-administration-assets.js";

function managed(path: string, max: number) {
  if (!isAbsolute(path)) throw Error("BUSINESS_MANAGED_FILE_REQUIRED");
  const s = lstatSync(path);
  if (!s.isFile() || s.isSymbolicLink() || s.size > max || process.platform !== "win32" && (s.mode & 0o077) !== 0) throw Error("BUSINESS_MANAGED_FILE_REQUIRED");
  return new TextDecoder("utf-8", { fatal: true }).decode(readFileSync(path));
}
export async function prepareBusinessAdministrationRuntime(pool: Pool, provisionFile: string, origin: string) {
  const policy = BusinessAdministrationProvisionSchema.parse(JSON.parse(managed(provisionFile, 32768)));
  validateCommercialHttpsOrigin(origin);
  if (policy.origin !== origin) throw Error("BUSINESS_ORIGIN_MISMATCH");
  const identity = (await pool.query(`SELECT current_database() AS db,inet_server_port() AS port,
    current_user='pos_platform_app' AND NOT rolsuper AND NOT rolbypassrls AND NOT rolcreatedb AND NOT rolcreaterole
    AND NOT pg_has_role(current_user,'pos_schema_owner','MEMBER') AS eligible FROM pg_roles WHERE rolname=current_user`)).rows[0];
  if (identity?.db !== policy.expected_database || identity?.port !== 5432 || identity?.eligible !== true) throw Error("BUSINESS_REGISTERED_DATABASE_REQUIRED");
  for (const [id, checksum] of Object.entries(policy.migration_checksums)) {
    const rows = (await pool.query("SELECT encode(checksum,'hex') AS checksum FROM platform.target_migration_executions WHERE migration_id=$1 AND status='APPLIED'", [id])).rows;
    if (rows.length !== 1 || rows[0]?.checksum !== checksum) throw Error("BUSINESS_REGISTERED_SCHEMA_REQUIRED");
  }
  const rejection = managed(policy.rejection_verifier_file, 8192).trim();
  if (!isSupportedPlatformPasswordVerifier(rejection)) throw Error("BUSINESS_REJECTION_VERIFIER_REQUIRED");
  const turnstile = policy.turnstile_secret_file
    ? managed(policy.turnstile_secret_file, 8192).trim()
    : null;
  if (policy.turnstile_secret_file && (!turnstile || turnstile.length < 16)) {
    throw Error("BUSINESS_TURNSTILE_SECRET_REQUIRED");
  }
  const turnstileSiteKey = policy.turnstile_site_key ?? null;
  if ((turnstile === null) !== (turnstileSiteKey === null)) {
    throw Error("BUSINESS_TURNSTILE_PAIR_REQUIRED");
  }
  const api = createBusinessAdministrationHandler(pool, policy, rejection, turnstile, turnstileSiteKey);
  const assets = createGlobalAdministrationAssets({
    directory: policy.renderer.directory, origin, maximumAssetBytes: policy.renderer.maximum_asset_bytes,
    page: "business", turnstileEnabled: turnstileSiteKey !== null,
  });
  return async (req: Parameters<typeof api>[0], res: Parameters<typeof api>[1]) => {
    if (req.url === "/business" || req.url?.startsWith("/business/")) await assets(req, res);
    else await api(req, res);
  };
}
