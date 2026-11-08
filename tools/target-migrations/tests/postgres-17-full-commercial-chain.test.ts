import {Pool} from "pg";
import {randomBytes} from "node:crypto";
import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {describe,expect,it} from "vitest";
import {applyPostgres001,applyPostgres002,postgresRoleUrls} from "../src/postgres.js";
import {applyRoleReadiness} from "../src/postgres-003-role-readiness.js";
import {applyPostgres003} from "../src/postgres-003-runner.js";
import {applyPostgres004} from "../src/postgres-004-runner.js";
import {applyPostgres005} from "../src/postgres-005-runner.js";
import {applyPostgres006} from "../src/postgres-006-runner.js";
import {applyPostgres007} from "../src/postgres-007-runner.js";
import {applyCommercialMigrations,commercialMigrationManifest} from "../src/postgres-commercial-runner.js";

/** A genuine uninterrupted 001 -> 016 application, without inserted fake
 * ledger rows, synthetic predecessor checksums, skipped smoke, or production
 * credentials. Requires an ephemeral localhost PostgreSQL 17.11 instance. */
describe("PG17.11 canonical full commercial chain",()=>{
  it("applies and checks every predecessor under its canonical migrator identity",async()=>{
    const source=process.env.POSTGRES_TEST_URL;
    if(!source)throw Error("EPHEMERAL_DATABASE_REQUIRED");
    const endpoint=new URL(source);
    if(endpoint.hostname!=="127.0.0.1"||endpoint.port!=="55433"||
      endpoint.pathname!=="/postgres"||endpoint.username!=="postgres")
      throw Error("EPHEMERAL_DATABASE_SCOPE_REJECTED");
    const database="camacho_chain_"+randomBytes(6).toString("hex");
    const root=mkdtempSync(join(tmpdir(),"camacho-pg17-chain-"));
    const commit="20351dd17de12be02b2b3a97ebcb7ace05fd6aa6";
    const admin=new Pool({connectionString:source,max:1});
    let created=false;
    try{
      const version=(await admin.query("SHOW server_version_num")).rows[0]?.server_version_num;
      expect(version).toBe("170011");
      await admin.query('CREATE DATABASE "'+database+'"');
      created=true;
      const dbUrl=new URL(source);dbUrl.pathname="/"+database;dbUrl.searchParams.set("sslmode","require");
      const url=dbUrl.toString();
      const context={adminUrl:url,expectedDatabase:database,repositoryCommit:commit};
      const a=await applyPostgres001({adminUrl:url});expect(a.noOp).toBe(false);
      const b=await applyPostgres002({adminUrl:url});expect(b.noOp).toBe(false);
      const roles=postgresRoleUrls(url);
      const ready=await applyRoleReadiness({
        provisioningUrl:roles.pos_migrator!,
        verificationUrl:roles.pos_platform_admin!,
        environmentId:"pg17-ci-canonical",expectedDatabase:database,
        repositoryCommit:commit,operatorOrJobId:"github-hosted-ephemeral",
        receiptOutputPath:join(root,"role-readiness.json"),
      });
      expect(ready.result).toBe("READY_WITH_RECEIPT");
      const three=await applyPostgres003({...context,environmentId:"pg17-ci-canonical",receiptOutputPath:join(root,"003-apply.json")});
      expect(three.result).toBe("APPLIED_WITH_RECEIPT");
      expect((await applyPostgres004(context)).result).toBe("APPLIED");
      expect((await applyPostgres005(context)).result).toBe("APPLIED");
      expect((await applyPostgres006(context)).result).toBe("APPLIED");
      expect((await applyPostgres007(context)).result).toBe("APPLIED");
      const migrator=new URL(url);migrator.username="pos_migrator";migrator.password="";
      const results=await applyCommercialMigrations({
        migratorUrl:migrator.toString(),expectedDatabase:database,
        repositoryCommit:commit,lockTimeoutMs:2000,statementTimeoutMs:30000,
        target:"AUTHENTICATION",
      });
      expect(results).toHaveLength(9);
      expect(results.every(r=>r.status==="APPLIED")).toBe(true);
      const pool=new Pool({connectionString:url,max:1});
      try{
        const ledger=await pool.query("SELECT migration_id,status FROM platform.target_migration_executions WHERE status='APPLIED' ORDER BY migration_id");
        const applied=new Set(ledger.rows.map(r=>r.migration_id));
        expect(applied.size).toBe(16);
        expect(applied).toEqual(new Set([
          "001_central_foundation","002_external_integrations_foundation",
          "003_fiscal_electronic_invoicing_foundation","004_device_trust",
          "005_onboarding_bootstrap_hardening","006_licensing_foundation",
          "007_password_recovery",...Object.keys(await commercialMigrationManifest("AUTHENTICATION")),
        ]));
        const rls=await pool.query(`SELECT c.relname,c.relrowsecurity,c.relforcerowsecurity,r.rolname
          FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
          JOIN pg_roles r ON r.oid=c.relowner
          WHERE n.nspname IN ('identity','tenancy','organization','authorization','licensing')
          AND c.relkind='r' AND c.relrowsecurity`);
        expect(rls.rows.length).toBeGreaterThan(20);
        expect(rls.rows.every(r=>r.relforcerowsecurity===true&&r.rolname==="pos_schema_owner")).toBe(true);
      }finally{await pool.end();}
    }finally{
      if(created){
        await admin.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()",[database]);
        await admin.query('DROP DATABASE IF EXISTS "'+database+'" WITH (FORCE)');
      }
      await admin.end();
      rmSync(root,{recursive:true,force:true});
    }
  },180_000);
});
