import {applyCommercialMigrations} from "./postgres-commercial-runner.js";
const required=(name:string)=>{const value=process.env[name];if(!value)throw Error(`${name} required`);return value;};
process.stdout.write(JSON.stringify(await applyCommercialMigrations({migratorUrl:required("POSTGRES_MIGRATOR_URL"),
  expectedDatabase:required("POSTGRES_EXPECTED_DATABASE"),repositoryCommit:required("REPOSITORY_COMMIT"),
  lockTimeoutMs:Number(required("POSTGRES_MIGRATION_LOCK_TIMEOUT_MS")),statementTimeoutMs:Number(required("POSTGRES_MIGRATION_STATEMENT_TIMEOUT_MS"))}))+"\n");
