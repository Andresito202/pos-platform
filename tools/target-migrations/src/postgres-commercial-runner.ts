import {isSupportedMigrationPostgresVersion} from "./postgres-compatibility.js";
import {Pool,type PoolClient} from "pg";
import { POSTGRES_003_DESCRIPTOR, type MigrationDescriptor } from "./contract.js";
import {POSTGRES_007_DESCRIPTOR} from "./postgres-007-contract.js";
import {POSTGRES_006_DESCRIPTOR} from "./postgres-006-contract.js";
import {POSTGRES_008_DESCRIPTOR} from "./postgres-008-platform-roles-contract.js";
import {POSTGRES_009_DESCRIPTOR} from "./postgres-009-webauthn-contract.js";
import {POSTGRES_010_DESCRIPTOR} from "./postgres-010-webauthn-material-contract.js";
import {POSTGRES_011_DESCRIPTOR} from "./postgres-011-ssa-sequence-contract.js";
import {POSTGRES_012_DESCRIPTOR} from "./postgres-012-device-proof-contract.js";
import {POSTGRES_013_DESCRIPTOR} from "./postgres-013-browser-sessions-contract.js";
import {MigrationInvariantError,POSTGRES_MIGRATION_LOCK_RESOURCE,RUNNER_VERSION,readArtifact,sha256,uuidV7} from "./shared.js";

const descriptor=(id:string,predecessor:string,tables:readonly string[],schema:string):MigrationDescriptor=>({migrationId:id,
  manifestVersion:1,dependencies:[predecessor],upArtifact:`postgres/${id}.up.sql`,downArtifact:`postgres/${id}.down.sql`,
  checksum:"DERIVED_FROM_UP_ARTIFACT",ownedSchemas:[schema],ownedTables:tables,ownedPolicies:"DERIVED_FROM_UP_ARTIFACT",
  ownedConstraints:"DERIVED_FROM_UP_ARTIFACT",ownedIndexes:"DERIVED_FROM_UP_ARTIFACT",requiredExtensions:[],expectedLedgerState:"APPLIED"});
export const POSTGRES_014_DESCRIPTOR=descriptor("014_commercial_refresh_binding",POSTGRES_013_DESCRIPTOR.migrationId,["identity.session_refresh_tokens"],"identity");
export const POSTGRES_015_DESCRIPTOR=descriptor("015_authorization_snapshot_sequences",POSTGRES_014_DESCRIPTOR.migrationId,["authorization.snapshot_sequences"],"authorization");
export const POSTGRES_016_DESCRIPTOR=descriptor("016_native_business_authorization",POSTGRES_015_DESCRIPTOR.migrationId,["identity.native_authorization_codes","identity.native_authorization_requests"],"identity");
export const COMMERCIAL_MIGRATIONS=Object.freeze([POSTGRES_008_DESCRIPTOR,POSTGRES_009_DESCRIPTOR,POSTGRES_010_DESCRIPTOR,
  POSTGRES_011_DESCRIPTOR,POSTGRES_012_DESCRIPTOR,POSTGRES_013_DESCRIPTOR,POSTGRES_014_DESCRIPTOR,POSTGRES_015_DESCRIPTOR,POSTGRES_016_DESCRIPTOR]);
export const POSTGRES_017_DESCRIPTOR={...descriptor("017_license_offer_pricing",POSTGRES_016_DESCRIPTOR.migrationId,["licensing.plans"],"licensing"),
  dependencies:[POSTGRES_016_DESCRIPTOR.migrationId,POSTGRES_006_DESCRIPTOR.migrationId]};
export const LICENSING_MIGRATIONS=Object.freeze([...COMMERCIAL_MIGRATIONS,POSTGRES_017_DESCRIPTOR]);
export const POSTGRES_018_DESCRIPTOR={...descriptor("018_factus_pay_webhook_inbox",POSTGRES_017_DESCRIPTOR.migrationId,
  ["integrations.factus_pay_webhook_keys","integrations.factus_pay_webhook_inbox"],"integrations"),
  dependencies:[POSTGRES_017_DESCRIPTOR.migrationId,POSTGRES_003_DESCRIPTOR.migrationId]};
export const FACTUS_PAY_MIGRATIONS=Object.freeze([...LICENSING_MIGRATIONS,POSTGRES_018_DESCRIPTOR]);
export const POSTGRES_019_DESCRIPTOR=descriptor("019_subscription_quotes",POSTGRES_018_DESCRIPTOR.migrationId,["subscriptions.license_quotes"],"subscriptions");
export const SUBSCRIPTION_MIGRATIONS=Object.freeze([...FACTUS_PAY_MIGRATIONS,POSTGRES_019_DESCRIPTOR]);
export const POSTGRES_020_DESCRIPTOR=descriptor("020_subscription_payments",POSTGRES_019_DESCRIPTOR.migrationId,
  ["payments.payment_groups","payments.payments","payments.payment_attempts","payments.payment_allocations"],"payments");
export const SUBSCRIPTION_PAYMENT_MIGRATIONS=Object.freeze([...SUBSCRIPTION_MIGRATIONS,POSTGRES_020_DESCRIPTOR]);
export const POSTGRES_021_DESCRIPTOR=descriptor("021_global_browser_administration",POSTGRES_020_DESCRIPTOR.migrationId,
  ["identity.webauthn_challenges","identity.browser_session_handoffs","identity.browser_sessions"],"identity");
export const GLOBAL_ADMINISTRATION_MIGRATIONS=Object.freeze([...SUBSCRIPTION_PAYMENT_MIGRATIONS,POSTGRES_021_DESCRIPTOR]);
export const POSTGRES_022_DESCRIPTOR=descriptor("022_license_activations",POSTGRES_021_DESCRIPTOR.migrationId,
  ["licensing.license_activations","licensing.trusted_signing_keys","licensing.license_revocations"],"licensing");
export const LICENSE_ACTIVATION_MIGRATIONS=Object.freeze([...GLOBAL_ADMINISTRATION_MIGRATIONS,POSTGRES_022_DESCRIPTOR]);
export const POSTGRES_023_DESCRIPTOR=descriptor("023_license_offer_terms",POSTGRES_022_DESCRIPTOR.migrationId,["licensing.plans"],"licensing");
export const LICENSE_CATALOG_MIGRATIONS=Object.freeze([...LICENSE_ACTIVATION_MIGRATIONS,POSTGRES_023_DESCRIPTOR]);
export const POSTGRES_029_DESCRIPTOR = descriptor(
  "029_cash_register_master",
  POSTGRES_023_DESCRIPTOR.migrationId,
  ["cash.cash_registers"],
  "cash"
);
export const CASH_REGISTER_MASTER_MIGRATIONS = Object.freeze([
  ...LICENSE_CATALOG_MIGRATIONS,
  POSTGRES_029_DESCRIPTOR
]);
export const POSTGRES_030_DESCRIPTOR = descriptor(
  "030_commercial_authorization_catalog",
  POSTGRES_029_DESCRIPTOR.migrationId,
  [],
  "authorization"
);
export const POSTGRES_031_DESCRIPTOR = descriptor(
  "031_business_owner_role",
  POSTGRES_030_DESCRIPTOR.migrationId,
  [],
  "authorization"
);
export const POSTGRES_032_DESCRIPTOR = descriptor(
  "032_tenant_initialization_permission",
  POSTGRES_031_DESCRIPTOR.migrationId,
  [],
  "authorization"
);
export const POSTGRES_033_DESCRIPTOR=descriptor("033_cash_register_license_bindings",POSTGRES_032_DESCRIPTOR.migrationId,
  ["licensing.cash_register_bindings"],"licensing");
export const POSTGRES_034_DESCRIPTOR=descriptor("034_reporting_aggregate_permissions",POSTGRES_033_DESCRIPTOR.migrationId,
  [],"authorization");
export const POSTGRES_035_DESCRIPTOR=descriptor("035_subscription_license_fulfillment",POSTGRES_023_DESCRIPTOR.migrationId,
  ["subscriptions.license_fulfillment_jobs"],"subscriptions");
export const POSTGRES_036_DESCRIPTOR=descriptor("036_business_login_abuse_budget",POSTGRES_021_DESCRIPTOR.migrationId,
  [],"identity");

export const POSTGRES_038_DESCRIPTOR=descriptor("038_commercial_portal_bridge",POSTGRES_021_DESCRIPTOR.migrationId,
  ["identity.commercial_bridge_sessions","identity.commercial_bridge_jtis","licensing.commercial_trial_grants","licensing.commercial_provisioning_receipts"],
  "identity");

type CommercialMigrationTarget="COMMERCIAL_PORTAL_BRIDGE"|"LOGIN_ABUSE_BUDGET"|"SUBSCRIPTION_FULFILLMENT"|"REPORTING_PERMISSIONS"|"CASH_REGISTER_BINDINGS"|"TENANT_INITIALIZATION"|"BUSINESS_OWNER"|"COMMERCIAL_AUTHORIZATION"|"CASH_REGISTER_MASTER"|"AUTHENTICATION"|"LICENSING"|"FACTUS_PAY"|"SUBSCRIPTIONS"|"SUBSCRIPTION_PAYMENTS"|"GLOBAL_ADMINISTRATION"|"LICENSE_ACTIVATIONS"|"LICENSE_CATALOG";
function migrations(target:CommercialMigrationTarget){
  if(target==="COMMERCIAL_PORTAL_BRIDGE")return [POSTGRES_038_DESCRIPTOR];
  if(target==="LOGIN_ABUSE_BUDGET")return [POSTGRES_036_DESCRIPTOR];
  if(target==="SUBSCRIPTION_FULFILLMENT")return [POSTGRES_035_DESCRIPTOR];
  if(target==="REPORTING_PERMISSIONS")return [POSTGRES_034_DESCRIPTOR];
  if(target==="CASH_REGISTER_BINDINGS")return [POSTGRES_033_DESCRIPTOR];
  if(target==="TENANT_INITIALIZATION")return [POSTGRES_032_DESCRIPTOR];
  if(target==="BUSINESS_OWNER")return [POSTGRES_031_DESCRIPTOR];
  if(target==="COMMERCIAL_AUTHORIZATION")return [POSTGRES_030_DESCRIPTOR];
  if(target==="CASH_REGISTER_MASTER")return [POSTGRES_029_DESCRIPTOR];
  if(target==="LICENSE_CATALOG")return LICENSE_CATALOG_MIGRATIONS;
  if(target==="LICENSE_ACTIVATIONS")return LICENSE_ACTIVATION_MIGRATIONS;
  if(target==="AUTHENTICATION")return COMMERCIAL_MIGRATIONS;
  if(target==="LICENSING")return LICENSING_MIGRATIONS;
  if(target==="FACTUS_PAY")return FACTUS_PAY_MIGRATIONS;
  if(target==="SUBSCRIPTIONS")return SUBSCRIPTION_MIGRATIONS;
  if(target==="SUBSCRIPTION_PAYMENTS")return SUBSCRIPTION_PAYMENT_MIGRATIONS;
  if(target==="GLOBAL_ADMINISTRATION")return GLOBAL_ADMINISTRATION_MIGRATIONS;
  throw new MigrationInvariantError("Unknown commercial migration target");
}
export async function commercialMigrationManifest(target:CommercialMigrationTarget="AUTHENTICATION"){
  return Object.fromEntries(await Promise.all(migrations(target).map(async d=>[d.migrationId,sha256(await readArtifact(d.upArtifact)).toString("hex")])));
}
const check:(ok:unknown,message:string)=>asserts ok=(ok,message)=>{if(!ok)throw new MigrationInvariantError(message);};

async function smoke(c:PoolClient,d:MigrationDescriptor){
  for(const table of d.ownedTables){
    const result=await c.query("SELECT r.rolname AS owner,c.relrowsecurity AS rls,c.relforcerowsecurity AS forced FROM pg_class c JOIN pg_roles r ON r.oid=c.relowner WHERE c.oid=to_regclass($1)",[table]);
    // 014 extends the existing Identity-central table, whose 001 contract uses
    // role grants rather than tenant RLS. It must not change that boundary.
    check(result.rows[0]?.owner==="pos_schema_owner"&&(d===POSTGRES_014_DESCRIPTOR||result.rows[0].rls&&result.rows[0].forced),`Commercial migration ownership/RLS mismatch: ${table}`);
  }
  if(d===POSTGRES_032_DESCRIPTOR){
    const grants=(await c.query(`
      SELECT r.code,r.scope_type
      FROM "authorization".role_permission_grants g
      JOIN "authorization".roles r ON r.id=g.role_id
      JOIN "authorization".permissions p ON p.id=g.permission_id
      WHERE p.code='TENANT_INITIALIZE'
        AND p.status='ACTIVE'
        AND g.status='ACTIVE'
        AND r.status='ACTIVE'
        AND g.valid_from<=clock_timestamp()
        AND (g.valid_until IS NULL OR g.valid_until>clock_timestamp())
    `)).rows;

    check(grants.length===1 &&
      grants[0]?.code==="PLATFORM_OWNER" &&
      grants[0]?.scope_type==="PLATFORM",
      "Tenant initialization permission boundary violated");
  }
  if(d===POSTGRES_034_DESCRIPTOR){
    const codes=(await c.query(`
      SELECT code FROM "authorization".permissions
      WHERE code IN (
        'REPORTING_SALES_AGGREGATE_READ',
        'REPORTING_CASH_AGGREGATE_READ',
        'REPORTING_PAYMENTS_AGGREGATE_READ'
      ) AND status='ACTIVE'
      ORDER BY code
    `)).rows.map((row:{code:string})=>row.code);
    check(codes.length===3, "Reporting aggregate permissions missing from catalog");
    const grants=(await c.query(`
      SELECT count(*)::int AS count
      FROM "authorization".role_permission_grants g
      JOIN "authorization".permissions p ON p.id=g.permission_id
      WHERE p.code IN (
        'REPORTING_SALES_AGGREGATE_READ',
        'REPORTING_CASH_AGGREGATE_READ',
        'REPORTING_PAYMENTS_AGGREGATE_READ'
      ) AND g.status='ACTIVE'
    `)).rows[0]?.count;
    check(grants===0, "Reporting aggregate permissions must not auto-grant to roles");
  }
  if(d===POSTGRES_031_DESCRIPTOR){
    const grants=(await c.query(`
      SELECT r.code AS role,p.code AS permission
      FROM "authorization".role_permission_grants g
      JOIN "authorization".roles r ON r.id=g.role_id
      JOIN "authorization".permissions p ON p.id=g.permission_id
      WHERE r.code IN ('OWNER','GENERAL_ADMIN')
        AND r.status='ACTIVE'
        AND p.status='ACTIVE'
        AND g.status='ACTIVE'
        AND g.valid_from<=clock_timestamp()
        AND (g.valid_until IS NULL OR g.valid_until>clock_timestamp())
    `)).rows;

    const owner=grants.filter(g=>g.role==="OWNER")
      .map(g=>g.permission).sort();

    const admin=grants.filter(g=>g.role==="GENERAL_ADMIN")
      .map(g=>g.permission).sort();

    check(owner.length===20,"Owner grant count mismatch");
    check(JSON.stringify(owner)===JSON.stringify(admin),
      "Owner permission mismatch");
    check(owner.includes("CASH_REGISTER_MANAGE"),
      "Owner cash register permission missing");
    check(!owner.some(p=>p.startsWith("LICENSE_")),
      "Owner global licensing forbidden");
  }
  if(d===POSTGRES_030_DESCRIPTOR){
    const grants=(await c.query(`
      SELECT r.code AS role,p.code AS permission
      FROM "authorization".role_permission_grants g
      JOIN "authorization".roles r ON r.id=g.role_id
      JOIN "authorization".permissions p ON p.id=g.permission_id
      WHERE g.status='ACTIVE'
        AND r.status='ACTIVE'
        AND p.status='ACTIVE'
        AND g.valid_from<=clock_timestamp()
        AND (g.valid_until IS NULL OR g.valid_until>clock_timestamp())
    `)).rows;

    const has=(role:string,permission:string)=>
      grants.some(g=>g.role===role&&g.permission===permission);

    const expected:Record<string,number>={
      PLATFORM_OWNER:3,
      GENERAL_ADMIN:20,
      SUPERVISOR:8,
      CASHIER:10
    };

    for(const [role,count] of Object.entries(expected)){
      check(grants.filter(g=>g.role===role).length===count,
        `Commercial role grant count mismatch: ${role}`);
    }

    check(has("GENERAL_ADMIN","CASH_REGISTER_MANAGE"),
      "Administrator cash register permission missing");

    check(has("SUPERVISOR","PAYMENTS_TRANSFER_CONFIRM"),
      "Supervisor transfer confirmation missing");

    check(has("CASHIER","SALES_SALE_CREATE"),
      "Cashier sales permission missing");

    check(has("PLATFORM_OWNER","LICENSE_ISSUE"),
      "Global license permission missing");

    for(const role of ["PLATFORM_OWNER","GENERAL_ADMIN","SUPERVISOR"]){
      for(const permission of [
        "SALES_SALE_CREATE",
        "CASH_SHIFT_OPEN",
        "CASH_SHIFT_CLOSE",
        "PAYMENTS_PAYMENT_REGISTER"
      ]){
        check(!has(role,permission),
          `Forbidden operational grant: ${role}/${permission}`);
      }
    }

    for(const role of ["PLATFORM_OWNER","SUPERVISOR","CASHIER"]){
      check(!has(role,"CASH_REGISTER_MANAGE"),
        `Forbidden cash register administration: ${role}`);
    }

    for(const role of ["GENERAL_ADMIN","SUPERVISOR","CASHIER"]){
      for(const permission of [
        "LICENSE_ISSUE",
        "LICENSE_REVOKE",
        "LICENSE_PLAN_MANAGE"
      ]){
        check(!has(role,permission),
          `Forbidden licensing grant: ${role}/${permission}`);
      }
    }

    check(!has("CASHIER","PAYMENTS_TRANSFER_CONFIRM"),
      "Cashier cannot confirm transfers");
  }
  if(d===POSTGRES_029_DESCRIPTOR){
    const table="cash.cash_registers";

    for(const role of ["pos_platform_app","pos_worker","pos_app"]){
      for(const privilege of ["SELECT","INSERT","UPDATE","DELETE","TRUNCATE","REFERENCES","TRIGGER"]){
        const expected=role==="pos_platform_app"
          ? ["SELECT","INSERT","UPDATE"].includes(privilege)
          : role==="pos_worker" && privilege==="SELECT";

        const result=await c.query(
          "SELECT has_table_privilege($1,$2,$3) AS allowed",
          [role,table,privilege]
        );

        check(result.rows[0]?.allowed===expected,
          `Cash register ACL mismatch: ${role}/${privilege}`);
      }
    }

    check((await c.query(`
      SELECT 1 FROM pg_trigger
      WHERE tgrelid='cash.cash_registers'::regclass
      AND tgname='cash_register_mutation_guard'
      AND tgenabled='O'
    `)).rowCount===1,"Cash register mutation guard missing");
  }
  if(d===POSTGRES_014_DESCRIPTOR){
    const columns=await c.query("SELECT attname FROM pg_attribute WHERE attrelid='identity.session_refresh_tokens'::regclass AND attnum>0 AND NOT attisdropped");
    check(["client_id","credential_id","family_expires_at","password_credential_version"].every(n=>columns.rows.some(r=>r.attname===n)),"Refresh binding columns missing");
    check((await c.query("SELECT 1 FROM pg_trigger WHERE tgrelid='identity.session_refresh_tokens'::regclass AND tgname='commercial_refresh_binding_guard' AND tgenabled='O'")).rowCount===1,"Refresh binding guard missing");
  }
  if(d===POSTGRES_017_DESCRIPTOR){
    const columns=(await c.query("SELECT attname FROM pg_attribute WHERE attrelid='licensing.plans'::regclass AND attnum>0 AND NOT attisdropped")).rows;
    check(["offer_profile","included_registers","additional_register_price_minor","support_price_minor","support_charge","offer_policy_reference"].every(name=>columns.some(r=>r.attname===name)),"License offer columns missing");
    check((await c.query("SELECT 1 FROM pg_trigger WHERE tgrelid='licensing.plans'::regclass AND tgname='licensing_offer_version_guard' AND tgenabled='O'")).rowCount===1,"License offer history guard missing");
  }
  if(d===POSTGRES_018_DESCRIPTOR){
    check((await c.query("SELECT 1 FROM pg_constraint WHERE conrelid='integrations.factus_pay_webhook_inbox'::regclass AND conname='factus_pay_webhook_inbox_dedup_uq'")).rowCount===1,"Factus Pay deduplication missing");
    for(const table of d.ownedTables){
      for(const role of ["pos_app","pos_worker","pos_reporting"])
        check(!(await c.query("SELECT has_table_privilege($1,$2,'SELECT,INSERT,UPDATE,DELETE') AS allowed",[role,table])).rows[0].allowed,"Factus Pay inbox exposed to tenant runtime");
      check(!(await c.query("SELECT has_table_privilege('pos_platform_app',$1,'DELETE') AS allowed",[table])).rows[0].allowed,"Factus Pay evidence must not be deletable");
    }
  }
  if(d===POSTGRES_020_DESCRIPTOR){
    check(!(await c.query("SELECT has_column_privilege('pos_platform_app','payments.payments','expected_amount','UPDATE') AS allowed")).rows[0].allowed,"Subscription payment amount must be immutable to runtime");
    for(const table of d.ownedTables){
      check(!(await c.query("SELECT has_table_privilege('pos_app',$1,'SELECT,INSERT,UPDATE,DELETE') AS allowed",[table])).rows[0].allowed,"Subscription payments exposed to local tenant runtime");
      check((await c.query("SELECT 1 FROM pg_trigger WHERE tgrelid=to_regclass($1) AND tgname='subscription_payment_no_truncate' AND tgenabled='O'",[table])).rowCount===1,"Subscription payment history guard missing");
    }
  }
  if(d===POSTGRES_015_DESCRIPTOR){
    const fn=(await c.query("SELECT p.prosecdef,p.prosrc,p.proconfig,r.rolname FROM pg_proc p JOIN pg_roles r ON r.oid=p.proowner WHERE p.oid=to_regprocedure('authorization.lock_sas_sources_for_read()')")).rows[0];
    const artifact=await readArtifact(d.upArtifact);
    check(fn?.prosecdef&&fn.rolname==="pos_schema_owner"&&fn.proconfig?.join()==="search_path=pg_catalog"&&
      artifact.split("$function$").at(-2)?.trim()===fn.prosrc.trim(),"SAS lock function drift");
    for(const table of ["roles","permissions","role_permission_grants"])
      check(!(await c.query("SELECT has_any_column_privilege('pos_platform_app',$1,'UPDATE') AS granted",[`authorization.${table}`])).rows[0].granted,"SAS reader must not gain UPDATE RBAC");
    for(const role of ["pos_app","pos_worker","pos_platform_admin"])
      check(!(await c.query("SELECT has_function_privilege($1,'authorization.lock_sas_sources_for_read()','EXECUTE') AS granted",[role])).rows[0].granted,"SAS function exposed outside Central");
  }
}

/** Same canonical migration lock, checksum ledger and transactional DDL. Only
 * registered successors of 007; never applies a proposals/ artifact or guesses
 * a predecessor. Operator URL, target, SHA and time limits are mandatory. */
export async function applyCommercialMigrations(input:{migratorUrl:string;expectedDatabase:string;repositoryCommit:string;lockTimeoutMs:number;statementTimeoutMs:number;target?:CommercialMigrationTarget}){
  const selected=migrations(input.target??"AUTHENTICATION");
  check(/^[0-9a-f]{40}$/.test(input.repositoryCommit)&&input.expectedDatabase.length>0,"Exact migration target/SHA required");
  check([input.lockTimeoutMs,input.statementTimeoutMs].every(n=>Number.isSafeInteger(n)&&n>0)&&input.statementTimeoutMs>input.lockTimeoutMs,"Explicit migration timeouts required");
  check(new URL(input.migratorUrl).username==="pos_migrator","Commercial runner requires pos_migrator URL");
  const pool=new Pool({connectionString:input.migratorUrl,max:1}),c=await pool.connect(),results=[];
  try{
    const target=(await c.query("SELECT current_database() AS db,session_user,current_setting('server_version_num') AS version")).rows[0];
    check(target.db===input.expectedDatabase&&target.session_user==="pos_migrator"&&isSupportedMigrationPostgresVersion(target.version),"Commercial migration target mismatch");
    await c.query("SET ROLE pos_schema_owner");
    await c.query("SELECT set_config('lock_timeout',$1,false),set_config('statement_timeout',$2,false)",[`${input.lockTimeoutMs}ms`,`${input.statementTimeoutMs}ms`]);
    await c.query("SELECT pg_advisory_lock(hashtextextended($1,0))",[POSTGRES_MIGRATION_LOCK_RESOURCE]);
    try{
      if(selected.includes(POSTGRES_017_DESCRIPTOR)){
        const foundation=(await c.query("SELECT checksum FROM platform.target_migration_executions WHERE migration_id=$1 AND status='APPLIED' ORDER BY applied_at DESC LIMIT 1",[POSTGRES_006_DESCRIPTOR.migrationId])).rows[0];
        check(foundation&&Buffer.from(foundation.checksum).equals(sha256(await readArtifact(POSTGRES_006_DESCRIPTOR.upArtifact))),"Licensing 006 predecessor mismatch");
      }
      if(selected.includes(POSTGRES_018_DESCRIPTOR)){
        const predecessor=(await c.query("SELECT checksum FROM platform.target_migration_executions WHERE migration_id=$1 AND status='APPLIED' ORDER BY applied_at DESC LIMIT 1",[POSTGRES_003_DESCRIPTOR.migrationId])).rows[0];
        check(predecessor&&Buffer.from(predecessor.checksum).equals(sha256(await readArtifact(POSTGRES_003_DESCRIPTOR.upArtifact))),"Factus Pay 003 predecessor mismatch");
      }
      let predecessor=input.target==="COMMERCIAL_PORTAL_BRIDGE"?POSTGRES_021_DESCRIPTOR:input.target==="LOGIN_ABUSE_BUDGET"?POSTGRES_021_DESCRIPTOR:input.target==="SUBSCRIPTION_FULFILLMENT"?POSTGRES_023_DESCRIPTOR:input.target==="REPORTING_PERMISSIONS"?POSTGRES_033_DESCRIPTOR:input.target==="CASH_REGISTER_BINDINGS"?POSTGRES_032_DESCRIPTOR:input.target==="TENANT_INITIALIZATION"?POSTGRES_031_DESCRIPTOR:input.target==="BUSINESS_OWNER"?POSTGRES_030_DESCRIPTOR:input.target==="COMMERCIAL_AUTHORIZATION"?POSTGRES_029_DESCRIPTOR:input.target==="CASH_REGISTER_MASTER"?POSTGRES_023_DESCRIPTOR:POSTGRES_007_DESCRIPTOR;
      for(const d of selected){
        const checksum=sha256(await readArtifact(d.upArtifact)),prior=sha256(await readArtifact(predecessor.upArtifact));
        const history=(await c.query("SELECT execution_id,checksum,status FROM platform.target_migration_executions WHERE migration_id=$1 ORDER BY started_at",[d.migrationId])).rows;
        check(history.every(r=>Buffer.from(r.checksum).equals(checksum)),`Commercial migration checksum mismatch: ${d.migrationId}`);
        const dependency=(await c.query("SELECT checksum FROM platform.target_migration_executions WHERE migration_id=$1 AND status='APPLIED' ORDER BY applied_at DESC LIMIT 1",[predecessor.migrationId])).rows[0];
        check(dependency&&Buffer.from(dependency.checksum).equals(prior),`Commercial migration predecessor mismatch: ${d.migrationId}`);
        const applied=history.find(r=>r.status==="APPLIED");
        if(applied){await smoke(c,d);results.push({migrationId:d.migrationId,status:"ALREADY_APPLIED",executionId:applied.execution_id});predecessor=d;continue;}
        check(!history.some(r=>r.status==="STARTED"),"STARTED migration requires reconciliation");
        const id=uuidV7();
        await c.query("INSERT INTO platform.target_migration_executions(execution_id,migration_id,dialect,manifest_version,checksum,status,started_at,runner_version) VALUES($1,$2,'POSTGRESQL',1,$3,'STARTED',clock_timestamp(),$4)",[id,d.migrationId,checksum,`${RUNNER_VERSION};repo=${input.repositoryCommit}`]);
        try{
          await c.query("BEGIN");await c.query(await readArtifact(d.upArtifact));await smoke(c,d);
          await c.query("UPDATE platform.target_migration_executions SET status='APPLIED',body_committed_at=clock_timestamp(),smoke_verified_at=clock_timestamp(),applied_at=clock_timestamp(),finished_at=clock_timestamp() WHERE execution_id=$1",[id]);
          await c.query("COMMIT");results.push({migrationId:d.migrationId,status:"APPLIED",executionId:id});
        }catch(error){await c.query("ROLLBACK");await c.query("UPDATE platform.target_migration_executions SET status='FAILED',error_code='COMMERCIAL_BODY_ROLLED_BACK',finished_at=clock_timestamp() WHERE execution_id=$1 AND status='STARTED'",[id]);throw error;}
        predecessor=d;
      }
      return results;
    }finally{await c.query("SELECT pg_advisory_unlock(hashtextextended($1,0))",[POSTGRES_MIGRATION_LOCK_RESOURCE]);}
  }finally{c.release();await pool.end();}
}
