export { applyPostgres001, applyPostgres002, downPostgres001, downPostgres002, postgresRoleUrls } from "./postgres.js";
export {
  MAT003_PREFLIGHT_GLOBAL_LOCK_RESOURCE,
  MAT003_PREFLIGHT_REQUIRED_SCHEMAS,
  MAT003_PREFLIGHT_REQUIRED_TABLE_COLUMNS,
  MAT003_PREFLIGHT_REQUIRED_TABLES,
  mat003PreflightExitCode,
  mat003PreflightUrlFailureCode,
  runMat003Preflight,
} from "./postgres-003-preflight.js";
export type { Mat003DatabaseState, Mat003PreflightCheck, Mat003PreflightResult } from "./postgres-003-preflight.js";
export {
  ROLE_READINESS_AUTOMATIC_REVERSAL_COMPATIBLE_VERSIONS,
  ROLE_READINESS_LIFECYCLE_CONTRACT_VERSION,
  ROLE_READINESS_RECEIPT_VERSION,
  applyRoleReadiness,
  canonicalJson,
  checkRoleReadiness,
  classifyRoleReadiness,
  inspectRoleReadinessAcl,
  revertRoleReadiness,
  validateRoleReadinessReceipt,
  validateRoleReadinessReversal,
} from "./postgres-003-role-readiness.js";
export type { RoleReadinessAclSnapshot, RoleReadinessConfig, RoleReadinessReceipt, RoleReadinessResult, RoleReadinessState } from "./postgres-003-role-readiness.js";
export { validatePostgres002Catalog, validatePostgresCatalog } from "./postgres-introspection.js";
export { applySqlite001, inspectSqlite001 } from "./sqlite.js";
export {
  MigrationInvariantError,
  POSTGRES_MIGRATION_ID,
  POSTGRES_002_MIGRATION_ID,
  POSTGRES_003_MIGRATION_ID,
  POSTGRES_004_MIGRATION_ID,
  SQLITE_MIGRATION_ID,
  SimulatedCrashError,
} from "./shared.js";
export { buildPostgres003UpSql, buildPostgres003DownSql } from "./postgres-003-artifact.js";
export { fiscal003CatalogState, validatePostgres003Catalog } from "./postgres-003-introspection.js";
export { runPostgres003Smoke } from "./postgres-003-smoke.js";
export { applyPostgres003, downPostgres003 } from "./postgres-003-runner.js";
export type { Postgres003RunnerConfig, Postgres003DownConfig, Postgres003ApplyResult } from "./postgres-003-runner.js";
export { POSTGRES_004_DESCRIPTOR, DEVICE_TRUST_004_COLUMNS, DEVICE_TRUST_004_TABLES } from "./postgres-004-contract.js";
export { applyPostgres004 } from "./postgres-004-runner.js";
export type { Postgres004RunnerConfig, Postgres004ApplyResult } from "./postgres-004-runner.js";

export { POSTGRES_005_DESCRIPTOR } from "./postgres-005-contract.js";
export { applyPostgres005 } from "./postgres-005-runner.js";
export type { Postgres005RunnerConfig, Postgres005ApplyResult } from "./postgres-005-runner.js";

export { POSTGRES_006_DESCRIPTOR, LICENSING_006_TABLES } from "./postgres-006-contract.js";
export { applyPostgres006 } from "./postgres-006-runner.js";
export type { Postgres006RunnerConfig, Postgres006ApplyResult } from "./postgres-006-runner.js";
export { POSTGRES_007_DESCRIPTOR, PASSWORD_RECOVERY_007_TABLES } from "./postgres-007-contract.js";
export { applyPostgres007 } from "./postgres-007-runner.js";
export type { Postgres007RunnerConfig, Postgres007ApplyResult } from "./postgres-007-runner.js";

export { POSTGRES_008_DESCRIPTOR, PLATFORM_ROLE_008_COLUMNS, PLATFORM_ROLE_008_TABLES } from "./postgres-008-platform-roles-contract.js";

export { POSTGRES_009_DESCRIPTOR, WEBAUTHN_009_COLUMNS, WEBAUTHN_009_TABLES } from "./postgres-009-webauthn-contract.js";
export { POSTGRES_010_DESCRIPTOR, WEBAUTHN_010_COLUMNS, WEBAUTHN_010_TABLES } from "./postgres-010-webauthn-material-contract.js";
export { POSTGRES_011_DESCRIPTOR, POSTGRES_011_SSA_SEQUENCE_TABLES, POSTGRES_011_SSA_SEQUENCE_COLUMNS } from "./postgres-011-ssa-sequence-contract.js";
export { POSTGRES_012_DESCRIPTOR, DEVICE_PROOF_012_TABLES, DEVICE_PROOF_012_COLUMNS } from "./postgres-012-device-proof-contract.js";
export {POSTGRES_013_DESCRIPTOR,BROWSER_SESSION_013_TABLES} from "./postgres-013-browser-sessions-contract.js";
export {applyCommercialMigrations,COMMERCIAL_MIGRATIONS,POSTGRES_014_DESCRIPTOR,POSTGRES_015_DESCRIPTOR,POSTGRES_016_DESCRIPTOR} from "./postgres-commercial-runner.js";
