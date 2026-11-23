/** Isolated GitHub Actions PR #130 verification. Never point at production. */
import {mkdtemp,mkdir,writeFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
import {Pool} from "pg";
import {applyPostgres001,applyPostgres002,postgresRoleUrls} from "./postgres.js";
import {applyRoleReadiness} from "./postgres-003-role-readiness.js";
import {applyPostgres003} from "./postgres-003-runner.js";
import {applyPostgres004} from "./postgres-004-runner.js";
import {applyPostgres005} from "./postgres-005-runner.js";
import {applyPostgres006} from "./postgres-006-runner.js";
import {applyPostgres007} from "./postgres-007-runner.js";
import {applyCommercialMigrations,commercialMigrationManifest} from "./postgres-commercial-runner.js";

async function run(){
  const sha=process.env.REPOSITORY_COMMIT??"";
  const url=process.env.POSTGRES_ADMIN_URL??"";
  const reviewed=process.env.REVIEWED_SHA??"";
  const evidenceDir=process.env.CAMACHO_CERT_EVIDENCE_DIR??"";
  if(!/^[a-f0-9]{40}$/.test(sha)||sha!==reviewed||!evidenceDir)throw Error("PR130_CERT_EXACT_SHA_AND_EVIDENCE_REQUIRED");
  const parsed=new URL(url);
  if(parsed.hostname!=="127.0.0.1"||parsed.port!=="55438"||parsed.pathname!=="/postgres"||parsed.username!=="postgres"
    ||process.env.GITHUB_ACTIONS!=="true"||process.env.GITHUB_REF!=="refs/heads/cursor/commercial-license-global-c53a"){
    throw Error("PR130_CERT_EPHEMERAL_LOOPBACK_ONLY");
  }
  const db="postgres";
  const temp=await mkdtemp(join(tmpdir(),"pr130-cert-"));
  const roles=postgresRoleUrls(url);
  const config={adminUrl:url,expectedDatabase:db,repositoryCommit:sha};
  try{
    await applyPostgres001({adminUrl:url,skipSmoke:true});
    await applyPostgres002({adminUrl:url,skipSmoke:true});
    await applyRoleReadiness({
      provisioningUrl:roles.pos_migrator!,
      verificationUrl:roles.pos_platform_admin!,
      environmentId:"pr130-ephemeral-actions",expectedDatabase:db,
      repositoryCommit:sha,operatorOrJobId:"github-actions-pr130",
      receiptOutputPath:join(temp,"role-readiness.json"),
    });
    await applyPostgres003({...config,environmentId:"pr130-ephemeral-actions",
      receiptOutputPath:join(temp,"migration-003.json")});
    await applyPostgres004(config);
    await applyPostgres005(config);
    await applyPostgres006(config);
    await applyPostgres007(config);
    await applyCommercialMigrations({
      migratorUrl:roles.pos_migrator!,expectedDatabase:db,repositoryCommit:sha,
      lockTimeoutMs:5000,statementTimeoutMs:20000,target:"LICENSE_CATALOG",
    });
    await applyCommercialMigrations({
      migratorUrl:roles.pos_migrator!,expectedDatabase:db,repositoryCommit:sha,
      lockTimeoutMs:5000,statementTimeoutMs:20000,target:"SUBSCRIPTION_FULFILLMENT",
    });
    const manifest=await commercialMigrationManifest("SUBSCRIPTION_FULFILLMENT");
    const admin=new Pool({connectionString:url,max:1});
    try{
      const verification=await admin.query(
        `SELECT e.status,encode(e.checksum,'hex') AS checksum,
          to_regclass('subscriptions.license_fulfillment_jobs') IS NOT NULL AS table_present,
          c.relrowsecurity AS rls,c.relforcerowsecurity AS forced
          FROM platform.target_migration_executions e
          JOIN pg_class c ON c.oid='subscriptions.license_fulfillment_jobs'::regclass
          WHERE e.migration_id='035_subscription_license_fulfillment'`,
      );
      const row=verification.rows[0];
      if(verification.rowCount!==1||row?.status!=="APPLIED"
        ||row.checksum!==manifest["035_subscription_license_fulfillment"]
        ||row.table_present!==true||row.rls!==true||row.forced!==true){
        throw Error("PR130_EPHEMERAL_035_LEDGER_OR_RLS_MISMATCH");
      }
      await mkdir(resolve(evidenceDir),{recursive:true});
      await writeFile(join(evidenceDir,"postgres-035-evidence.json"),JSON.stringify({
        commit:sha,environment:"github-actions-disposable-postgres-16.14",
        migration:"035_subscription_license_fulfillment",status:"APPLIED",
        checksum:row.checksum,rls:true,force_rls:true,
        postgres_ephemeral_verified:true,commercial_production_verified:false,
        factus_sandbox_verified:false,license_issued:false,device_activated:false,
        runtime_verified:false,
      },null,2)+"\n",{mode:0o600});
      console.log("PR130_EPHEMERAL_POSTGRES_035_VERIFIED");
    }finally{await admin.end();}
  }finally{await rm(temp,{recursive:true,force:true});}
}
await run();
