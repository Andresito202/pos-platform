import {applyCommercialMigrations,commercialMigrationManifest} from "./postgres-commercial-runner.js";
const required=(name:string)=>{const value=process.env[name];if(!value)throw Error(`${name} required`);return value;};
if(["--licensing","--factus-pay","--subscriptions","--subscription-payments","--global-administration","--license-activations","--license-catalog","--merchant-destinations"].filter(f=>process.argv.includes(f)).length>1)throw Error("Choose one migration target");
const target=process.argv.includes("--merchant-destinations")?"MERCHANT_DESTINATIONS":process.argv.includes("--license-catalog")?"LICENSE_CATALOG":process.argv.includes("--license-activations")?"LICENSE_ACTIVATIONS":process.argv.includes("--global-administration")?"GLOBAL_ADMINISTRATION":process.argv.includes("--subscription-payments")?"SUBSCRIPTION_PAYMENTS":process.argv.includes("--subscriptions")?"SUBSCRIPTIONS":process.argv.includes("--factus-pay")?"FACTUS_PAY":process.argv.includes("--licensing")?"LICENSING":"AUTHENTICATION";
if(process.argv.includes("--manifest"))process.stdout.write(JSON.stringify(await commercialMigrationManifest(target))+"\n");
else process.stdout.write(JSON.stringify(await applyCommercialMigrations({migratorUrl:required("POSTGRES_MIGRATOR_URL"),
  expectedDatabase:required("POSTGRES_EXPECTED_DATABASE"),repositoryCommit:required("REPOSITORY_COMMIT"),
  lockTimeoutMs:Number(required("POSTGRES_MIGRATION_LOCK_TIMEOUT_MS")),statementTimeoutMs:Number(required("POSTGRES_MIGRATION_STATEMENT_TIMEOUT_MS")),target}))+"\n");
