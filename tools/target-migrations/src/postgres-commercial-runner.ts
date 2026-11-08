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
export const POSTGRES_024_DESCRIPTOR=descriptor("024_merchant_payment_destinations",POSTGRES_023_DESCRIPTOR.migrationId,
  ["payments.merchant_qr_assets","payments.merchant_destinations","payments.merchant_destination_events",
   "payments.merchant_destination_outbox","payments.merchant_destination_sequences","payments.merchant_destination_acknowledgements"],"payments");
export const MERCHANT_DESTINATION_MIGRATIONS=Object.freeze([...LICENSE_CATALOG_MIGRATIONS,POSTGRES_024_DESCRIPTOR]);
export const POSTGRES_025_DESCRIPTOR=descriptor("025_merchant_payment_notifications",POSTGRES_024_DESCRIPTOR.migrationId,
 ["payments.merchant_notification_bridge_consents","payments.merchant_payment_notification_inbox"],"payments");
export const POSTGRES_026_DESCRIPTOR=descriptor("026_merchant_payment_notice_reported_details",POSTGRES_025_DESCRIPTOR.migrationId,
 ["payments.merchant_payment_notification_inbox"],"payments");
export const MERCHANT_NOTIFICATION_MIGRATIONS=Object.freeze([...MERCHANT_DESTINATION_MIGRATIONS,POSTGRES_025_DESCRIPTOR,POSTGRES_026_DESCRIPTOR]);
type CommercialMigrationTarget="AUTHENTICATION"|"LICENSING"|"FACTUS_PAY"|"SUBSCRIPTIONS"|"SUBSCRIPTION_PAYMENTS"|"GLOBAL_ADMINISTRATION"|"LICENSE_ACTIVATIONS"|"LICENSE_CATALOG"|"MERCHANT_DESTINATIONS"|"MERCHANT_NOTIFICATIONS";
function migrations(target:CommercialMigrationTarget){
  if(target==="MERCHANT_NOTIFICATIONS")return MERCHANT_NOTIFICATION_MIGRATIONS;
  if(target==="MERCHANT_DESTINATIONS")return MERCHANT_DESTINATION_MIGRATIONS;
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
  if(d===POSTGRES_026_DESCRIPTOR){
    const fields=await c.query("SELECT attname FROM pg_attribute WHERE attrelid='payments.merchant_payment_notification_inbox'::regclass AND attname=ANY($1) AND attnum>0 AND NOT attisdropped",[
      ["reported_amount_cop","payer_display"]]);
    check(fields.rowCount===2,"QR002 reported-amount fields absent");
    for(const constraint of ["merchant_notice_reported_amount_positive","merchant_notice_payer_display_size"])
      check((await c.query("SELECT 1 FROM pg_constraint WHERE conrelid='payments.merchant_payment_notification_inbox'::regclass AND conname=$1",[constraint])).rowCount===1,
        "QR002 reported evidence constraint missing: "+constraint);
  }
  if(d===POSTGRES_025_DESCRIPTOR){
    for(const table of d.ownedTables){
      for(const role of ["pos_app","pos_worker","pos_reporting"])
        check(!(await c.query("SELECT has_table_privilege($1,$2,'SELECT,INSERT,UPDATE,DELETE') AS allowed",[role,table])).rows[0].allowed,
          "Merchant notification inbox exposed to local tenant runtime");
      check(!(await c.query("SELECT has_table_privilege('pos_platform_app',$1,'DELETE') AS allowed",[table])).rows[0].allowed,
        "Merchant notice evidence must not be deletable");
      check((await c.query("SELECT 1 FROM pg_trigger WHERE tgrelid=to_regclass($1) AND tgname='merchant_notice_no_truncate' AND tgenabled='O'",[table])).rowCount===1,
        "Merchant notification truncation guard missing");
    }
    const guards=[
      ["payments.merchant_notification_bridge_consents","merchant_notice_consent_guard"],
      ["payments.merchant_notification_bridge_consents","merchant_notice_consent_no_delete"],
      ["payments.merchant_payment_notification_inbox","merchant_notice_intake_guard"],
      ["payments.merchant_payment_notification_inbox","merchant_notice_inbox_immutable"],
    ] as const;
    for(const [table,trigger] of guards)
      check((await c.query("SELECT 1 FROM pg_trigger WHERE tgrelid=to_regclass($1) AND tgname=$2 AND tgenabled='O'",[table,trigger])).rowCount===1,
        "Merchant notification required trigger missing: "+trigger);
    check(!(await c.query("SELECT has_table_privilege('pos_platform_app','payments.merchant_payment_notification_inbox','UPDATE') AS allowed")).rows[0].allowed,
      "Unverified notification evidence must be append-only");
  }
  if(d===POSTGRES_024_DESCRIPTOR){
    for(const table of d.ownedTables){
      for(const role of ["pos_app","pos_worker","pos_reporting"])
        check(!(await c.query("SELECT has_table_privilege($1,$2,'SELECT,INSERT,UPDATE,DELETE') AS allowed",[role,table])).rows[0].allowed,
          "Merchant destinations exposed to local tenant role");
      check(!(await c.query("SELECT has_table_privilege('pos_platform_app',$1,'DELETE') AS allowed",[table])).rows[0].allowed,
        "Merchant destination evidence deletable");
      check((await c.query("SELECT 1 FROM pg_trigger WHERE tgrelid=to_regclass($1) AND tgname='merchant_no_truncate' AND tgenabled='O'",[table])).rowCount===1,
        "Merchant destination truncation guard missing");
    }
    const checks=[
      ["payments.merchant_destinations","merchant_destination_transition"],
      ["payments.merchant_destinations","merchant_destination_insert"],
      ["payments.merchant_destinations","merchant_destination_no_delete"],
      ["payments.merchant_qr_assets","merchant_asset_immutable"],
      ["payments.merchant_destination_events","merchant_event_immutable"],
      ["payments.merchant_destination_outbox","merchant_outbox_immutable"],
      ["payments.merchant_destination_sequences","merchant_sequence_monotonic"],
      ["payments.merchant_destination_acknowledgements","merchant_ack_monotonic"],
      ["payments.merchant_destination_acknowledgements","merchant_ack_identity"],
    ] as const;
    for(const [table,trigger] of checks)
      check((await c.query("SELECT 1 FROM pg_trigger WHERE tgrelid=to_regclass($1) AND tgname=$2 AND tgenabled='O'",[table,trigger])).rowCount===1,
        "Merchant destination required trigger missing: "+trigger);
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
    check(target.db===input.expectedDatabase&&target.session_user==="pos_migrator"&&target.version==="160014","Commercial migration target mismatch");
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
      let predecessor=POSTGRES_007_DESCRIPTOR;
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
