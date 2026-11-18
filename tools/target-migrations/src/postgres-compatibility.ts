/** Explicitly evaluated PostgreSQL patch targets for the POS migration chain.
 * Neither a major-version wildcard nor a configuration override is permitted.
 * 17.11 is a preproduction candidate: production approval additionally requires
 * successful physical migration, catalog, role and RLS evidence on this patch.
 */
export const POSTGRES_CANONICAL_VERSION = "160014" as const;
export const POSTGRES_17_PREPRODUCTION_CANDIDATE = "170011" as const;
export type ApprovedMigrationPostgresVersion =
  | typeof POSTGRES_CANONICAL_VERSION
  | typeof POSTGRES_17_PREPRODUCTION_CANDIDATE;

export function isSupportedMigrationPostgresVersion(version: unknown): version is ApprovedMigrationPostgresVersion {
  return version === POSTGRES_CANONICAL_VERSION || version === POSTGRES_17_PREPRODUCTION_CANDIDATE;
}

export function assertSupportedMigrationPostgresVersion(version: unknown): asserts version is ApprovedMigrationPostgresVersion {
  if (!isSupportedMigrationPostgresVersion(version)) throw Error("POSTGRES_MIGRATION_VERSION_REJECTED");
}
