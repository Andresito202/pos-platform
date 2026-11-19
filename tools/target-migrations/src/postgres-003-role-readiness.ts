import { open, readFile, readdir, unlink } from "node:fs/promises";
import type { SqlExecutor } from "./database.js";
import { executeRaw, postgresDatabase, queryRows } from "./database.js";
import * as contract from "./contract.js";
import { validatePostgres002Catalog } from "./postgres-introspection.js";
import {
  POSTGRES_MIGRATION_LOCK_RESOURCE,
  isoNow,
  readArtifact,
  sha256,
  uuidV7,
} from "./shared.js";

export const ROLE_READINESS_RECEIPT_VERSION = 2 as const;
export const ROLE_READINESS_LIFECYCLE_CONTRACT_VERSION = 2 as const;
export const ROLE_READINESS_TARGET_ROLE = "pos_platform_admin" as const;
export const ROLE_READINESS_OPERATION_TYPE = "MAT003_PREFLIGHT_CANONICAL_ROLE_READINESS" as const;
export const ROLE_READINESS_AUTOMATIC_REVERSAL_COMPATIBLE_VERSIONS = [1, 2] as const;

export type RoleReadinessState = "MISSING" | "READY" | "PARTIAL" | "UNEXPECTED";
export type ReversalFailureCode =
  | "RECEIPT_MISSING"
  | "INVALID_RECEIPT"
  | "RECEIPT_INTEGRITY_FAILURE"
  | "TARGET_MISMATCH"
  | "ARTIFACT_OR_CONTRACT_MISMATCH"
  | "CURRENT_SECURITY_STATE_MISMATCH"
  | "CATALOG_OR_PREDECESSOR_INVALID"
  | "LATER_DEPENDENCY_NOT_PROVEN_SAFE";

export interface AclEntry {
  grantee: string;
  grantor: string;
  privilege: string;
  is_grantable: boolean;
}

export interface ColumnAclSnapshot {
  column_name: string;
  raw_acl_is_null: boolean;
  entries: AclEntry[];
}

export interface RoleReadinessAclSnapshot {
  schema: { raw_acl_is_null: boolean; entries: AclEntry[] };
  table: { raw_acl_is_null: boolean; entries: AclEntry[] };
  columns: ColumnAclSnapshot[];
  effective: {
    schema_usage: boolean;
    schema_create: boolean;
    table_select: boolean;
    columns: { column_name: string; select: boolean }[];
    writes: { privilege: string; allowed: boolean }[];
  };
  memberships: { granted_role: string; member_role: string; set_option: boolean; inherit_option: boolean; admin_option: boolean }[];
  ownership: { object: string; owner: string }[];
  target_role_attributes: RoleAttributes;
}

interface RoleAttributes {
  login: boolean;
  superuser: boolean;
  bypassrls: boolean;
  inherit: boolean;
  createdb: boolean;
  createrole: boolean;
  replication: boolean;
}

interface ArtifactHashes {
  readiness_up_sha256: string;
  readiness_down_sha256: string;
  migration_001_up_sha256: string;
  migration_001_down_sha256: string;
  migration_002_up_sha256: string;
  migration_002_down_sha256: string;
}

interface RoleReadinessReceiptPayloadBase {
  operation_id: string;
  operation_type: typeof ROLE_READINESS_OPERATION_TYPE;
  operation: "APPLY";
  result: "SUCCESS";
  repository_commit: string;
  artifacts: ArtifactHashes;
  target: { environment_id: string; database_name: string; postgres_version_num: "160014" };
  identities: { session_user: "pos_migrator"; effective_role: "pos_schema_owner"; target_role: typeof ROLE_READINESS_TARGET_ROLE; operator_or_job_id: string | null };
  started_at: string;
  completed_at: string;
  global_lock_resource: typeof POSTGRES_MIGRATION_LOCK_RESOURCE;
  state_before: "MISSING";
  acl_before: RoleReadinessAclSnapshot;
  state_after: "READY";
  acl_after: RoleReadinessAclSnapshot;
  contract_validation_before: "PASS";
  contract_validation_after: "PASS";
  catalog_validation_before: "PASS";
  catalog_validation_after: "PASS";
}

export interface RoleReadinessReceiptPayloadV1 extends RoleReadinessReceiptPayloadBase {
  receipt_version: 1;
  lifecycle_contract_version: 1;
  governance: { sql_003: "ABSENT"; descriptor_003: "ABSENT"; migration_003_ledger_entries: 0; fiscal_schema: "ABSENT" };
}

export interface RoleReadinessReceiptPayloadV2 extends RoleReadinessReceiptPayloadBase {
  receipt_version: 2;
  lifecycle_contract_version: 2;
  governance: {
    sql_003: "ABSENT" | "PRESENT_UNAPPLIED";
    descriptor_003: "PRESENT_UNAPPLIED";
    migration_003_ledger_entries: 0;
    fiscal_schema: "ABSENT";
  };
}

export type RoleReadinessReceiptPayload = RoleReadinessReceiptPayloadV1 | RoleReadinessReceiptPayloadV2;

export interface RoleReadinessReceipt {
  receipt_payload: RoleReadinessReceiptPayload;
  receipt_sha256: string;
}

export interface RoleReadinessConfig {
  provisioningUrl: string;
  verificationUrl: string;
  environmentId: string;
  expectedDatabase: string;
  repositoryCommit: string;
  operatorOrJobId?: string;
  receiptOutputPath?: string;
}

export interface RoleReadinessResult {
  operation: "CHECK" | "APPLY" | "REVERT";
  result: "PASS" | "READY_NO_OP" | "READY_WITH_RECEIPT" | "APPLIED_WITHOUT_DURABLE_RECEIPT" | "REVERTED" | "FAIL";
  state: RoleReadinessState | null;
  failure_code: string | null;
  operation_id: string | null;
  receipt_path: string | null;
  receipt_sha256: string | null;
}

class ReadinessError extends Error {
  constructor(readonly code: string) { super(code); }
}

const REQUIRED_COLUMNS = ["migration_id", "status", "checksum"] as const;
const WRITE_PRIVILEGES = ["INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"] as const;
const EXPECTED_HASHES = {
  migration_001_up_sha256: "7f188dd5c14a33f223e4684ace877d588278081924ab4c7286eb105a7c829507",
  migration_001_down_sha256: "383a26d046beb31975e0a5f00657aea00b9748de67f1188ca2fc7edfe765c0b7",
  migration_002_up_sha256: "8b22fdbc76ff79178d3063541012d7f428ed6d538d9027edb7987ebbbe09a554",
  migration_002_down_sha256: "91acc3576b784daa261fa8e125c32fed522c0c5be12dd8c8fc91ed0c60bb1cf6",
} as const;

function fail(operation: RoleReadinessResult["operation"], code: string, state: RoleReadinessState | null = null): RoleReadinessResult {
  return { operation, result: "FAIL", state, failure_code: code, operation_id: null, receipt_path: null, receipt_sha256: null };
}

function invariant(value: unknown, code: string): asserts value {
  if (!value) throw new ReadinessError(code);
}

function validateConfig(config: RoleReadinessConfig, requireOutput = false): void {
  for (const [name, value] of [["PROVISIONING_URL", config.provisioningUrl], ["VERIFICATION_URL", config.verificationUrl]] as const) {
    invariant(typeof value === "string" && value.length > 0, `${name}_REQUIRED`);
    try { const parsed = new URL(value); invariant(parsed.protocol === "postgres:" || parsed.protocol === "postgresql:", `${name}_INVALID`); }
    catch { throw new ReadinessError(`${name}_INVALID`); }
  }
  invariant(config.environmentId.trim().length > 0, "ENVIRONMENT_ID_REQUIRED");
  invariant(/^[A-Za-z0-9_.-]+$/.test(config.environmentId), "ENVIRONMENT_ID_INVALID");
  invariant(config.expectedDatabase.trim().length > 0, "EXPECTED_DATABASE_REQUIRED");
  invariant(/^[0-9a-f]{40}$/.test(config.repositoryCommit), "REPOSITORY_COMMIT_INVALID");
  if (config.operatorOrJobId !== undefined) invariant(config.operatorOrJobId.trim().length > 0, "OPERATOR_OR_JOB_ID_INVALID");
  if (requireOutput) invariant(typeof config.receiptOutputPath === "string" && config.receiptOutputPath.length > 0, "RECEIPT_OUTPUT_PATH_REQUIRED");
}

function sqlLiteral(value: string): string { return `'${value.replaceAll("'", "''")}'`; }

async function artifactHashes(): Promise<ArtifactHashes> {
  const [readinessUp, readinessDown, up001, down001, up002, down002] = await Promise.all([
    readArtifact("postgres/provisioning/mat-003-preflight-canonical-role-readiness.up.sql"),
    readArtifact("postgres/provisioning/mat-003-preflight-canonical-role-readiness.down.sql"),
    readArtifact("postgres/001_central_foundation.up.sql"), readArtifact("postgres/001_central_foundation.down.sql"),
    readArtifact("postgres/002_external_integrations_foundation.up.sql"), readArtifact("postgres/002_external_integrations_foundation.down.sql"),
  ]);
  const hashes = {
    readiness_up_sha256: sha256(readinessUp).toString("hex"), readiness_down_sha256: sha256(readinessDown).toString("hex"),
    migration_001_up_sha256: sha256(up001).toString("hex"), migration_001_down_sha256: sha256(down001).toString("hex"),
    migration_002_up_sha256: sha256(up002).toString("hex"), migration_002_down_sha256: sha256(down002).toString("hex"),
  };
  invariant(Object.entries(EXPECTED_HASHES).every(([key, value]) => hashes[key as keyof ArtifactHashes] === value), "ARTIFACT_OR_CONTRACT_MISMATCH");
  return hashes;
}

async function repository003ArtifactState(): Promise<RoleReadinessReceiptPayloadV2["governance"]> {
  const names = await readdir(new URL("../sql/postgres/", import.meta.url));
  const descriptor = contract.POSTGRES_003_DESCRIPTOR;
  invariant(descriptor?.migrationId === "003_fiscal_electronic_invoicing_foundation", "CATALOG_OR_PREDECESSOR_INVALID");
  invariant(sameObject(descriptor.dependencies, ["001_central_foundation", "002_external_integrations_foundation"]), "CATALOG_OR_PREDECESSOR_INVALID");
  invariant(descriptor.sqliteArtifact === "NONE" && descriptor.fiscalTableCount === 10, "CATALOG_OR_PREDECESSOR_INVALID");

  const expectedUp = descriptor.upArtifact.replace("postgres/", "");
  const expectedDown = descriptor.downArtifact.replace("postgres/", "");
  const upPresent = names.includes(expectedUp);
  const downPresent = names.includes(expectedDown);
  invariant(upPresent === downPresent, "CATALOG_OR_PREDECESSOR_INVALID");

  const unexpected003 = names.filter((name) => /^003(?:_|\.|-)/.test(name) && name !== expectedUp && name !== expectedDown);
  invariant(unexpected003.length === 0, "CATALOG_OR_PREDECESSOR_INVALID");

  return {
    sql_003: upPresent ? "PRESENT_UNAPPLIED" : "ABSENT",
    descriptor_003: "PRESENT_UNAPPLIED",
    migration_003_ledger_entries: 0,
    fiscal_schema: "ABSENT",
  };
}

async function verifyRuntimeAndTarget(db: SqlExecutor, config: RoleReadinessConfig, expectedUser: string): Promise<void> {
  const row = (await queryRows<{ database: string; version: string; session_user: string; current_user: string }>(db,
    "SELECT current_database() database,current_setting('server_version_num') version,session_user,current_user"))[0];
  invariant(row?.database === config.expectedDatabase, "TARGET_MISMATCH");
  invariant(row.version === "160014", "TARGET_MISMATCH");
  invariant(row.session_user === expectedUser && row.current_user === expectedUser, "IDENTITY_MISMATCH");
}

async function roleAttributes(db: SqlExecutor, role: string): Promise<RoleAttributes> {
  const row = (await queryRows<{ login:boolean; superuser:boolean; bypassrls:boolean; inherit:boolean; createdb:boolean; createrole:boolean; replication:boolean }>(db, `
    SELECT rolcanlogin login,rolsuper superuser,rolbypassrls bypassrls,rolinherit inherit,
           rolcreatedb createdb,rolcreaterole createrole,rolreplication replication
    FROM pg_roles WHERE rolname=${sqlLiteral(role)}`))[0];
  invariant(row, "ROLE_CONTRACT_INVALID");
  return row;
}

function sameObject(left: unknown, right: unknown): boolean { return canonicalJson(left) === canonicalJson(right); }

async function verifyRoleContract(db: SqlExecutor): Promise<void> {
  const expected: Record<string, RoleAttributes> = {
    pos_schema_owner: { login:false,superuser:false,bypassrls:false,inherit:true,createdb:false,createrole:false,replication:false },
    pos_migrator: { login:true,superuser:false,bypassrls:false,inherit:false,createdb:false,createrole:false,replication:false },
    pos_platform_admin: { login:true,superuser:false,bypassrls:true,inherit:false,createdb:false,createrole:false,replication:false },
  };
  for (const [name, attrs] of Object.entries(expected)) invariant(sameObject(await roleAttributes(db, name), attrs), "ROLE_CONTRACT_INVALID");
  const rows = await queryRows<{ granted_role:string; member_role:string; set_option:boolean; inherit_option:boolean; admin_option:boolean }>(db, `
    SELECT parent.rolname granted_role,member.rolname member_role,m.set_option,m.inherit_option,m.admin_option
    FROM pg_auth_members m JOIN pg_roles parent ON parent.oid=m.roleid JOIN pg_roles member ON member.oid=m.member
    WHERE (parent.rolname='pos_schema_owner' AND member.rolname='pos_migrator')
       OR parent.rolname='pos_platform_admin' OR member.rolname='pos_platform_admin'
    ORDER BY 1,2`);
  invariant(rows.length === 1 && sameObject(rows[0], {granted_role:"pos_schema_owner",member_role:"pos_migrator",set_option:true,inherit_option:false,admin_option:false}), "MEMBERSHIP_CONTRACT_INVALID");
}

async function acquireLock(db: SqlExecutor): Promise<void> {
  const row = (await queryRows<{ acquired:boolean }>(db, `SELECT pg_try_advisory_xact_lock(hashtextextended('${POSTGRES_MIGRATION_LOCK_RESOURCE}',0)) acquired`))[0];
  invariant(row?.acquired, "GLOBAL_LOCK_UNAVAILABLE");
}

async function verifyPredecessors(db: SqlExecutor): Promise<void> {
  const hashes = await artifactHashes();
  const rows = await queryRows<{migration_id:string;status:string;checksum:string}>(db, `
    SELECT migration_id,status,encode(checksum,'hex') checksum FROM platform.target_migration_executions
    WHERE migration_id IN ('001_central_foundation','002_external_integrations_foundation') ORDER BY migration_id`);
  invariant(rows.length === 2
    && rows[0]?.migration_id === "001_central_foundation" && rows[0].status === "APPLIED" && rows[0].checksum === hashes.migration_001_up_sha256
    && rows[1]?.migration_id === "002_external_integrations_foundation" && rows[1].status === "APPLIED" && rows[1].checksum === hashes.migration_002_up_sha256,
  "CATALOG_OR_PREDECESSOR_INVALID");
  const governance = (await queryRows<{entries:string;fiscal:boolean}>(db, `SELECT
    (SELECT count(*)::text FROM platform.target_migration_executions WHERE migration_id LIKE '003\\_%' ESCAPE '\\') entries,
    to_regnamespace('fiscal') IS NOT NULL fiscal`))[0];
  invariant(governance?.entries === "0" && !governance.fiscal, "CATALOG_OR_PREDECESSOR_INVALID");
  await repository003ArtifactState();
  try { await validatePostgres002Catalog(db); } catch { throw new ReadinessError("CATALOG_OR_PREDECESSOR_INVALID"); }
}

async function aclEntries(db: SqlExecutor, expression: string): Promise<AclEntry[]> {
  return queryRows<AclEntry>(db, `SELECT CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END grantee,
    pg_get_userbyid(a.grantor) grantor,a.privilege_type privilege,a.is_grantable
    FROM ${expression} a ORDER BY 1,2,3,4`);
}

export async function inspectRoleReadinessAcl(db: SqlExecutor): Promise<RoleReadinessAclSnapshot> {
  const schemaRaw = (await queryRows<{is_null:boolean}>(db, "SELECT nspacl IS NULL is_null FROM pg_namespace WHERE nspname='platform'"))[0];
  const tableRaw = (await queryRows<{is_null:boolean}>(db, "SELECT c.relacl IS NULL is_null FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='platform' AND c.relname='target_migration_executions'"))[0];
  invariant(schemaRaw && tableRaw, "CATALOG_OR_PREDECESSOR_INVALID");
  const schemaEntries = await aclEntries(db, "aclexplode((SELECT nspacl FROM pg_namespace WHERE nspname='platform'))");
  const tableEntries = await aclEntries(db, "aclexplode((SELECT c.relacl FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='platform' AND c.relname='target_migration_executions'))");
  const relationOid="(SELECT c.oid FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='platform' AND c.relname='target_migration_executions')";
  const columns = await queryRows<{column_name:string;raw_acl_is_null:boolean}>(db, `SELECT a.attname column_name,a.attacl IS NULL raw_acl_is_null
    FROM pg_attribute a WHERE a.attrelid=${relationOid} AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attname`);
  const columnSnapshots: ColumnAclSnapshot[] = [];
  for (const column of columns) {
    const entries = await aclEntries(db, `aclexplode((SELECT x.attacl FROM pg_attribute x WHERE x.attrelid=${relationOid} AND x.attname=${sqlLiteral(column.column_name)}))`);
    columnSnapshots.push({...column, entries});
  }
  const effective = (await queryRows<{schema_usage:boolean;schema_create:boolean;table_select:boolean}>(db, `SELECT
    has_schema_privilege('${ROLE_READINESS_TARGET_ROLE}','platform','USAGE') schema_usage,
    has_schema_privilege('${ROLE_READINESS_TARGET_ROLE}','platform','CREATE') schema_create,
    has_table_privilege('${ROLE_READINESS_TARGET_ROLE}',${relationOid},'SELECT') table_select`))[0]!;
  const effectiveColumns = await queryRows<{column_name:string;select:boolean}>(db, `SELECT a.attname column_name,
    has_column_privilege('${ROLE_READINESS_TARGET_ROLE}',${relationOid},a.attname,'SELECT') "select"
    FROM pg_attribute a WHERE a.attrelid=${relationOid} AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attname`);
  const writes = await queryRows<{privilege:string;allowed:boolean}>(db, `SELECT p.privilege,
    has_table_privilege('${ROLE_READINESS_TARGET_ROLE}',${relationOid},p.privilege) allowed
    FROM (VALUES ${WRITE_PRIVILEGES.map((p)=>`('${p}')`).join(",")}) p(privilege) ORDER BY p.privilege`);
  const memberships = await queryRows<{granted_role:string;member_role:string;set_option:boolean;inherit_option:boolean;admin_option:boolean}>(db, `SELECT parent.rolname granted_role,member.rolname member_role,m.set_option,m.inherit_option,m.admin_option
    FROM pg_auth_members m JOIN pg_roles parent ON parent.oid=m.roleid JOIN pg_roles member ON member.oid=m.member
    WHERE parent.rolname='${ROLE_READINESS_TARGET_ROLE}' OR member.rolname='${ROLE_READINESS_TARGET_ROLE}' ORDER BY 1,2`);
  const ownership = await queryRows<{object:string;owner:string}>(db, `SELECT 'schema:platform' object,pg_get_userbyid(nspowner) owner FROM pg_namespace WHERE nspname='platform'
    UNION ALL SELECT 'table:platform.target_migration_executions',pg_get_userbyid(c.relowner) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='platform' AND c.relname='target_migration_executions' ORDER BY 1`);
  return {
    schema:{raw_acl_is_null:schemaRaw.is_null,entries:schemaEntries}, table:{raw_acl_is_null:tableRaw.is_null,entries:tableEntries}, columns:columnSnapshots,
    effective:{...effective,columns:effectiveColumns,writes}, memberships, ownership,
    target_role_attributes:await roleAttributes(db, ROLE_READINESS_TARGET_ROLE),
  };
}

function relevant(entries: AclEntry[]): AclEntry[] { return entries.filter((entry) => entry.grantee === ROLE_READINESS_TARGET_ROLE || entry.grantee === "PUBLIC"); }

export function classifyRoleReadiness(snapshot: RoleReadinessAclSnapshot): RoleReadinessState {
  const schemaRelevant = relevant(snapshot.schema.entries);
  const tableRelevant = relevant(snapshot.table.entries);
  const columnRelevant = snapshot.columns.flatMap((column) => relevant(column.entries).map((entry)=>({column:column.column_name,...entry})));
  const requiredDirect = new Set<string>();
  let unexpected = snapshot.memberships.length > 0
    || snapshot.ownership.some((entry)=>entry.owner!=="pos_schema_owner")
    || !sameObject(snapshot.target_role_attributes,{login:true,superuser:false,bypassrls:true,inherit:false,createdb:false,createrole:false,replication:false})
    || snapshot.effective.schema_create || snapshot.effective.table_select
    || snapshot.effective.writes.some((entry)=>entry.allowed);
  for (const entry of schemaRelevant) {
    if (entry.grantee===ROLE_READINESS_TARGET_ROLE && entry.grantor==="pos_schema_owner" && entry.privilege==="USAGE" && !entry.is_grantable) requiredDirect.add("schema:USAGE");
    else unexpected = true;
  }
  for (const entry of tableRelevant) unexpected = true;
  for (const entry of columnRelevant) {
    if (entry.grantee===ROLE_READINESS_TARGET_ROLE && entry.grantor==="pos_schema_owner" && entry.privilege==="SELECT" && !entry.is_grantable && REQUIRED_COLUMNS.includes(entry.column as typeof REQUIRED_COLUMNS[number])) requiredDirect.add(`column:${entry.column}`);
    else unexpected = true;
  }
  for (const column of snapshot.effective.columns) {
    const required = REQUIRED_COLUMNS.includes(column.column_name as typeof REQUIRED_COLUMNS[number]);
    if (column.select !== (required && requiredDirect.has(`column:${column.column_name}`))) unexpected = true;
  }
  if (snapshot.effective.schema_usage !== requiredDirect.has("schema:USAGE")) unexpected = true;
  if (unexpected) return "UNEXPECTED";
  if (requiredDirect.size === 0) return "MISSING";
  if (requiredDirect.size === REQUIRED_COLUMNS.length + 1) return "READY";
  return "PARTIAL";
}

async function prepareLockedOwner(db: SqlExecutor, config: RoleReadinessConfig): Promise<void> {
  await acquireLock(db);
  await verifyRuntimeAndTarget(db, config, "pos_migrator");
  await verifyRoleContract(db);
  await executeRaw(db, "SET LOCAL ROLE pos_schema_owner");
  const identity = (await queryRows<{session_user:string;current_user:string}>(db, "SELECT session_user,current_user"))[0];
  invariant(identity?.session_user === "pos_migrator" && identity.current_user === "pos_schema_owner", "IDENTITY_MISMATCH");
  await verifyPredecessors(db);
}

async function inspectUnderLock(config: RoleReadinessConfig): Promise<{state:RoleReadinessState;acl:RoleReadinessAclSnapshot}> {
  const database = postgresDatabase(config.provisioningUrl, 1);
  try {
    return await database.connection().execute(async (connection) => {
      await executeRaw(connection, "BEGIN");
      try { await prepareLockedOwner(connection, config); const acl=await inspectRoleReadinessAcl(connection); await executeRaw(connection,"ROLLBACK"); return {state:classifyRoleReadiness(acl),acl}; }
      catch(error){ try{await executeRaw(connection,"ROLLBACK");}catch{} throw error; }
    });
  } finally { await database.destroy(); }
}

export async function freshAdminPostcheck(config: RoleReadinessConfig, expected: "MISSING" | "READY"): Promise<RoleReadinessAclSnapshot> {
  const database=postgresDatabase(config.verificationUrl,1);
  try { return await database.connection().execute(async(connection)=>{
    await verifyRuntimeAndTarget(connection,config,ROLE_READINESS_TARGET_ROLE);
    const attrs=await roleAttributes(connection,ROLE_READINESS_TARGET_ROLE);
    invariant(sameObject(attrs,{login:true,superuser:false,bypassrls:true,inherit:false,createdb:false,createrole:false,replication:false}),"ROLE_CONTRACT_INVALID");
    const acl=await inspectRoleReadinessAcl(connection);const observed=classifyRoleReadiness(acl);
    invariant(observed!=="PARTIAL"&&observed!=="UNEXPECTED"&&observed===expected,"CURRENT_SECURITY_STATE_MISMATCH");return acl;
  }); } finally { await database.destroy(); }
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue).sort((left,right)=>JSON.stringify(left).localeCompare(JSON.stringify(right)));
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value as Record<string,unknown>).sort().map((key)=>[key,canonicalValue((value as Record<string,unknown>)[key])]));
  if (value === undefined || typeof value === "function" || typeof value === "symbol" || typeof value === "bigint" || (typeof value === "number" && !Number.isFinite(value))) throw new ReadinessError("INVALID_RECEIPT");
  return value;
}

export function canonicalJson(value: unknown): string { return JSON.stringify(canonicalValue(value)); }

function exactKeys(value: unknown, keys: readonly string[]): asserts value is Record<string,unknown> {
  invariant(value !== null && typeof value === "object" && !Array.isArray(value), "INVALID_RECEIPT");
  invariant(sameObject(Object.keys(value as Record<string,unknown>).sort(), [...keys].sort()), "INVALID_RECEIPT");
}

function validateAcl(value: unknown): asserts value is RoleReadinessAclSnapshot {
  exactKeys(value,["schema","table","columns","effective","memberships","ownership","target_role_attributes"]);
  const object=value as Record<string,unknown>;
  for(const key of ["schema","table"]){ exactKeys(object[key],["raw_acl_is_null","entries"]); invariant(typeof (object[key] as Record<string,unknown>).raw_acl_is_null==="boolean" && Array.isArray((object[key] as Record<string,unknown>).entries),"INVALID_RECEIPT"); }
  invariant(Array.isArray(object.columns)&&Array.isArray(object.memberships)&&Array.isArray(object.ownership),"INVALID_RECEIPT");
  const entryKeys=["grantee","grantor","privilege","is_grantable"];
  const supportedPrivileges=new Set(["CREATE","USAGE","SELECT","INSERT","UPDATE","DELETE","TRUNCATE","REFERENCES","TRIGGER","MAINTAIN"]);
  const validateEntries=(items:unknown[])=>items.forEach(item=>{exactKeys(item,entryKeys);invariant(typeof item.grantee==="string"&&item.grantee.length>0&&typeof item.grantor==="string"&&item.grantor.length>0&&typeof item.privilege==="string"&&supportedPrivileges.has(item.privilege)&&typeof item.is_grantable==="boolean","INVALID_RECEIPT");});
  validateEntries((object.schema as {entries:unknown[]}).entries);validateEntries((object.table as {entries:unknown[]}).entries);
  for(const column of object.columns){exactKeys(column,["column_name","raw_acl_is_null","entries"]);invariant(typeof column.column_name==="string"&&typeof column.raw_acl_is_null==="boolean"&&Array.isArray(column.entries),"INVALID_RECEIPT");validateEntries(column.entries);}
  const expectedColumnNames=[...contract.POSTGRES_TABLE_COLUMNS["platform.target_migration_executions"]].sort();
  invariant(sameObject((object.columns as {column_name:string}[]).map(item=>item.column_name),expectedColumnNames),"INVALID_RECEIPT");
  for(const member of object.memberships){exactKeys(member,["granted_role","member_role","set_option","inherit_option","admin_option"]);invariant(typeof member.granted_role==="string"&&typeof member.member_role==="string"&&typeof member.set_option==="boolean"&&typeof member.inherit_option==="boolean"&&typeof member.admin_option==="boolean","INVALID_RECEIPT");}
  for(const owner of object.ownership){exactKeys(owner,["object","owner"]);invariant(typeof owner.object==="string"&&typeof owner.owner==="string","INVALID_RECEIPT");}
  invariant(sameObject((object.ownership as {object:string}[]).map(item=>item.object),["schema:platform","table:platform.target_migration_executions"]),"INVALID_RECEIPT");
  exactKeys(object.target_role_attributes,["login","superuser","bypassrls","inherit","createdb","createrole","replication"]);
  invariant(Object.values(object.target_role_attributes as Record<string,unknown>).every(item=>typeof item==="boolean"),"INVALID_RECEIPT");
  exactKeys(object.effective,["schema_usage","schema_create","table_select","columns","writes"]);
  const effective=object.effective as Record<string,unknown>; invariant(typeof effective.schema_usage==="boolean"&&typeof effective.schema_create==="boolean"&&typeof effective.table_select==="boolean"&&Array.isArray(effective.columns)&&Array.isArray(effective.writes),"INVALID_RECEIPT");
  for(const column of effective.columns){exactKeys(column,["column_name","select"]);invariant(typeof column.column_name==="string"&&typeof column.select==="boolean","INVALID_RECEIPT");}
  for(const write of effective.writes){exactKeys(write,["privilege","allowed"]);invariant(typeof write.privilege==="string"&&typeof write.allowed==="boolean","INVALID_RECEIPT");}
  invariant(sameObject((effective.columns as {column_name:string}[]).map(item=>item.column_name),expectedColumnNames),"INVALID_RECEIPT");
  invariant(sameObject((effective.writes as {privilege:string}[]).map(item=>item.privilege),[...WRITE_PRIVILEGES].sort()),"INVALID_RECEIPT");
  const arrays=[(object.schema as {entries:unknown[]}).entries,(object.table as {entries:unknown[]}).entries,object.columns,object.memberships,object.ownership,effective.columns,effective.writes] as unknown[][];
  for(const items of arrays){const keys=items.map(item=>canonicalJson(item));const sorted=[...keys].sort();invariant(keys.every((key,index)=>key===sorted[index]),"INVALID_RECEIPT");}
}

export function validateRoleReadinessReceipt(value: unknown): RoleReadinessReceipt {
  exactKeys(value,["receipt_payload","receipt_sha256"]); const wrapper=value as Record<string,unknown>;
  invariant(typeof wrapper.receipt_sha256==="string"&&/^[0-9a-f]{64}$/.test(wrapper.receipt_sha256),"INVALID_RECEIPT");
  exactKeys(wrapper.receipt_payload,["receipt_version","lifecycle_contract_version","operation_id","operation_type","operation","result","repository_commit","artifacts","target","identities","started_at","completed_at","global_lock_resource","state_before","acl_before","state_after","acl_after","contract_validation_before","contract_validation_after","catalog_validation_before","catalog_validation_after","governance"]);
  const payload=wrapper.receipt_payload as Record<string,unknown>;
  const versionPairValid =
    (payload.receipt_version === 1 && payload.lifecycle_contract_version === 1) ||
    (payload.receipt_version === 2 && payload.lifecycle_contract_version === 2);
  invariant(versionPairValid&&payload.operation_type===ROLE_READINESS_OPERATION_TYPE&&payload.operation==="APPLY"&&payload.result==="SUCCESS"&&payload.state_before==="MISSING"&&payload.state_after==="READY", "INVALID_RECEIPT");
  invariant(typeof payload.operation_id==="string"&&/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(payload.operation_id),"INVALID_RECEIPT");
  invariant(typeof payload.repository_commit==="string"&&/^[0-9a-f]{40}$/.test(payload.repository_commit),"INVALID_RECEIPT");
  for(const key of ["started_at","completed_at"]){const date=payload[key];invariant(typeof date==="string"&&!Number.isNaN(Date.parse(date))&&new Date(date).toISOString()===date,"INVALID_RECEIPT");}
  invariant(payload.global_lock_resource===POSTGRES_MIGRATION_LOCK_RESOURCE&&payload.contract_validation_before==="PASS"&&payload.contract_validation_after==="PASS"&&payload.catalog_validation_before==="PASS"&&payload.catalog_validation_after==="PASS","INVALID_RECEIPT");
  exactKeys(payload.artifacts,["readiness_up_sha256","readiness_down_sha256","migration_001_up_sha256","migration_001_down_sha256","migration_002_up_sha256","migration_002_down_sha256"]);invariant(Object.values(payload.artifacts as Record<string,unknown>).every(item=>typeof item==="string"&&/^[0-9a-f]{64}$/.test(item)),"INVALID_RECEIPT");
  exactKeys(payload.target,["environment_id","database_name","postgres_version_num"]);const target=payload.target as Record<string,unknown>;invariant(typeof target.environment_id==="string"&&target.environment_id.length>0&&typeof target.database_name==="string"&&target.database_name.length>0&&target.postgres_version_num==="160014","INVALID_RECEIPT");
  exactKeys(payload.identities,["session_user","effective_role","target_role","operator_or_job_id"]);const identities=payload.identities as Record<string,unknown>;invariant(identities.session_user==="pos_migrator"&&identities.effective_role==="pos_schema_owner"&&identities.target_role===ROLE_READINESS_TARGET_ROLE&&(identities.operator_or_job_id===null||(typeof identities.operator_or_job_id==="string"&&identities.operator_or_job_id.length>0)),"INVALID_RECEIPT");
  exactKeys(payload.governance,["sql_003","descriptor_003","migration_003_ledger_entries","fiscal_schema"]);const governance=payload.governance as Record<string,unknown>;
  if (payload.receipt_version === 1) {
    invariant(governance.sql_003==="ABSENT"&&governance.descriptor_003==="ABSENT"&&governance.migration_003_ledger_entries===0&&governance.fiscal_schema==="ABSENT","INVALID_RECEIPT");
  } else {
    invariant((governance.sql_003==="ABSENT"||governance.sql_003==="PRESENT_UNAPPLIED")&&governance.descriptor_003==="PRESENT_UNAPPLIED"&&governance.migration_003_ledger_entries===0&&governance.fiscal_schema==="ABSENT","INVALID_RECEIPT");
  }
  validateAcl(payload.acl_before);validateAcl(payload.acl_after);invariant(classifyRoleReadiness(payload.acl_before)==="MISSING"&&classifyRoleReadiness(payload.acl_after)==="READY","INVALID_RECEIPT");
  const digest=sha256(canonicalJson(payload)).toString("hex");invariant(digest===wrapper.receipt_sha256,"RECEIPT_INTEGRITY_FAILURE");
  return value as unknown as RoleReadinessReceipt;
}

async function publishReceipt(path:string,receipt:RoleReadinessReceipt):Promise<void>{
  const handle=await open(path,"wx");
  try{await handle.writeFile(`${JSON.stringify(receipt,null,2)}\n`,"utf8");await handle.sync();}
  catch(error){try{await handle.close();}catch{}try{await unlink(path);}catch{}throw error;}
  await handle.close();
}

export async function checkRoleReadiness(config:RoleReadinessConfig):Promise<RoleReadinessResult>{
  try{validateConfig(config);await artifactHashes();const inspected=await inspectUnderLock(config);invariant(inspected.state!=="PARTIAL", "PARTIAL_STATE");invariant(inspected.state!=="UNEXPECTED", "UNEXPECTED_STATE");await freshAdminPostcheck(config,inspected.state);return {operation:"CHECK",result:"PASS",state:inspected.state,failure_code:null,operation_id:null,receipt_path:null,receipt_sha256:null};}
  catch(error){return fail("CHECK",error instanceof ReadinessError?error.code:"INTERNAL_ERROR");}
}

export async function applyRoleReadiness(config:RoleReadinessConfig):Promise<RoleReadinessResult>{
  let committed=false;let operationId:string|null=null;let receiptHash:string|null=null;let after:RoleReadinessAclSnapshot|null=null;let before:RoleReadinessAclSnapshot|null=null;const startedAt=isoNow();
  try{
    validateConfig(config,true);const artifacts=await artifactHashes();const up=await readArtifact("postgres/provisioning/mat-003-preflight-canonical-role-readiness.up.sql");const database=postgresDatabase(config.provisioningUrl,1);
    try{await database.connection().execute(async(connection)=>{await executeRaw(connection,"BEGIN");try{await prepareLockedOwner(connection,config);before=await inspectRoleReadinessAcl(connection);const state=classifyRoleReadiness(before);invariant(state==="MISSING"||state==="READY",state==="PARTIAL"?"PARTIAL_STATE":"UNEXPECTED_STATE");if(state==="READY"){await executeRaw(connection,"COMMIT");return;}await executeRaw(connection,up);after=await inspectRoleReadinessAcl(connection);invariant(classifyRoleReadiness(after)==="READY","CURRENT_SECURITY_STATE_MISMATCH");await validatePostgres002Catalog(connection);await executeRaw(connection,"COMMIT");committed=true;operationId=uuidV7();}catch(error){try{await executeRaw(connection,"ROLLBACK");}catch{}throw error;}});}finally{await database.destroy();}
    if(!operationId){await freshAdminPostcheck(config,"READY");return {operation:"APPLY",result:"READY_NO_OP",state:"READY",failure_code:null,operation_id:null,receipt_path:null,receipt_sha256:null};}
    const fresh=await freshAdminPostcheck(config,"READY");invariant(sameObject(fresh,after),"CURRENT_SECURITY_STATE_MISMATCH");
    const repositoryGovernance=await repository003ArtifactState();
    const payload:RoleReadinessReceiptPayloadV2={receipt_version:ROLE_READINESS_RECEIPT_VERSION,lifecycle_contract_version:ROLE_READINESS_LIFECYCLE_CONTRACT_VERSION,operation_id:operationId,operation_type:ROLE_READINESS_OPERATION_TYPE,operation:"APPLY",result:"SUCCESS",repository_commit:config.repositoryCommit,artifacts,target:{environment_id:config.environmentId,database_name:config.expectedDatabase,postgres_version_num:"160014"},identities:{session_user:"pos_migrator",effective_role:"pos_schema_owner",target_role:ROLE_READINESS_TARGET_ROLE,operator_or_job_id:config.operatorOrJobId??null},started_at:startedAt,completed_at:isoNow(),global_lock_resource:POSTGRES_MIGRATION_LOCK_RESOURCE,state_before:"MISSING",acl_before:before!,state_after:"READY",acl_after:after!,contract_validation_before:"PASS",contract_validation_after:"PASS",catalog_validation_before:"PASS",catalog_validation_after:"PASS",governance:repositoryGovernance};
    receiptHash=sha256(canonicalJson(payload)).toString("hex");const receipt={receipt_payload:payload,receipt_sha256:receiptHash};
    try{await publishReceipt(config.receiptOutputPath!,receipt);}catch{return {operation:"APPLY",result:"APPLIED_WITHOUT_DURABLE_RECEIPT",state:"READY",failure_code:"RECEIPT_PUBLICATION_FAILED",operation_id:operationId,receipt_path:null,receipt_sha256:null};}
    return {operation:"APPLY",result:"READY_WITH_RECEIPT",state:"READY",failure_code:null,operation_id:operationId,receipt_path:config.receiptOutputPath!,receipt_sha256:receiptHash};
  }catch(error){if(committed)return {operation:"APPLY",result:"APPLIED_WITHOUT_DURABLE_RECEIPT",state:"READY",failure_code:error instanceof ReadinessError?error.code:"POSTCOMMIT_VERIFICATION_FAILED",operation_id:operationId,receipt_path:null,receipt_sha256:null};return fail("APPLY",error instanceof ReadinessError?error.code:"INTERNAL_ERROR");}
}

async function readReceipt(path:string|undefined):Promise<RoleReadinessReceipt>{
  invariant(typeof path==="string"&&path.length>0,"RECEIPT_MISSING");let source:string;
  try{source=await readFile(path,"utf8");}catch(error){if((error as NodeJS.ErrnoException).code==="ENOENT")throw new ReadinessError("RECEIPT_MISSING");throw new ReadinessError("INVALID_RECEIPT");}
  let parsed:unknown;try{parsed=JSON.parse(source);}catch{throw new ReadinessError("INVALID_RECEIPT");}return validateRoleReadinessReceipt(parsed);
}

async function validateReversal(config:RoleReadinessConfig,receipt:RoleReadinessReceipt,current:RoleReadinessAclSnapshot):Promise<void>{
  const payload=receipt.receipt_payload;
  invariant(payload.target.environment_id===config.environmentId&&payload.target.database_name===config.expectedDatabase&&payload.target.postgres_version_num==="160014","TARGET_MISMATCH");
  invariant(ROLE_READINESS_AUTOMATIC_REVERSAL_COMPATIBLE_VERSIONS.includes(payload.lifecycle_contract_version),"LATER_DEPENDENCY_NOT_PROVEN_SAFE");
  const hashes=await artifactHashes();invariant(sameObject(payload.artifacts,hashes),"ARTIFACT_OR_CONTRACT_MISMATCH");
  invariant(classifyRoleReadiness(current)==="READY"&&sameObject(current,payload.acl_after),"CURRENT_SECURITY_STATE_MISMATCH");
}

function reversalCode(error:unknown):ReversalFailureCode{
  const code=error instanceof ReadinessError?error.code:"CATALOG_OR_PREDECESSOR_INVALID";
  if(["ROLE_CONTRACT_INVALID","MEMBERSHIP_CONTRACT_INVALID","IDENTITY_MISMATCH"].includes(code))return "CURRENT_SECURITY_STATE_MISMATCH";
  if(code==="GLOBAL_LOCK_UNAVAILABLE")return "CURRENT_SECURITY_STATE_MISMATCH";
  return code as ReversalFailureCode;
}

export async function validateRoleReadinessReversal(config:RoleReadinessConfig,receiptPath:string|undefined):Promise<{status:"VALID_FOR_REVERSAL"}|{status:ReversalFailureCode}>{
  try{validateConfig(config);const receipt=await readReceipt(receiptPath);const inspected=await inspectUnderLock(config);await validateReversal(config,receipt,inspected.acl);return {status:"VALID_FOR_REVERSAL"};}
  catch(error){return {status:reversalCode(error)};}
}

export async function revertRoleReadiness(config:RoleReadinessConfig,receiptPath:string|undefined):Promise<RoleReadinessResult>{
  try{
    validateConfig(config);const receipt=await readReceipt(receiptPath);const down=await readArtifact("postgres/provisioning/mat-003-preflight-canonical-role-readiness.down.sql");const database=postgresDatabase(config.provisioningUrl,1);
    try{await database.connection().execute(async(connection)=>{await executeRaw(connection,"BEGIN");try{await prepareLockedOwner(connection,config);const current=await inspectRoleReadinessAcl(connection);await validateReversal(config,receipt,current);await executeRaw(connection,down);const after=await inspectRoleReadinessAcl(connection);invariant(classifyRoleReadiness(after)==="MISSING"&&sameObject(after,receipt.receipt_payload.acl_before),"CURRENT_SECURITY_STATE_MISMATCH");await validatePostgres002Catalog(connection);await executeRaw(connection,"COMMIT");}catch(error){try{await executeRaw(connection,"ROLLBACK");}catch{}throw error;}});}finally{await database.destroy();}
    const fresh=await freshAdminPostcheck(config,"MISSING");invariant(sameObject(fresh,receipt.receipt_payload.acl_before),"CURRENT_SECURITY_STATE_MISMATCH");return {operation:"REVERT",result:"REVERTED",state:"MISSING",failure_code:null,operation_id:receipt.receipt_payload.operation_id,receipt_path:receiptPath!,receipt_sha256:receipt.receipt_sha256};
  }catch(error){return fail("REVERT",reversalCode(error));}
}
