/**
 * Windows preprod MAT003: guarded ONE-SHOT official canonical ACL application.
 *
 * Requires explicit --apply-mat003. Never changes roles, secrets, TLS, schema
 * or migration history; only the official reviewed role-readiness GRANT.
 *
 * No reliance on possibly stale PowerShell env URLs. Fail closed if receipt
 * exists, authorization was already granted, Git is dirty, or any gate fails.
 * Never automatically retry after a failed or ambiguous apply.
 */
import {existsSync,readFileSync} from "node:fs";
import {execFileSync} from "node:child_process";
import {join,resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {
  applyRoleReadiness,checkRoleReadiness,validateRoleReadinessReceipt,
  type RoleReadinessConfig,
} from "./postgres-003-role-readiness.js";

if(process.argv.length!==3||process.argv[2]!=="--apply-mat003")
  throw Error("PREPROD_MAT003_EXPLICIT_APPLY_FLAG_REQUIRED");
const root=process.env.LOCALAPPDATA;
if(process.platform!=="win32"||!root)
  throw Error("PREPROD_MAT003_WINDOWS_REQUIRED");
if(process.env.PGPASSWORD!==undefined)
  throw Error("PREPROD_MAT003_GENERIC_PASSWORD_ENV_FORBIDDEN");
const dir=join(root,"CamachoPOS","preprod");
const passfile=join(dir,"pgpass.conf");
const ca=join(dir,"pg-server-ca.crt");
const receipt=join(dir,"mat003-role-readiness-20261029.json");
if(!existsSync(passfile)||!existsSync(ca))
  throw Error("PREPROD_MAT003_PROTECTED_MATERIAL_MISSING");
if(existsSync(receipt))
  throw Error("PREPROD_MAT003_RECEIPT_ALREADY_EXISTS_STOP_AND_REVIEW");
process.env.PGPASSFILE=passfile;
const repository=resolve(fileURLToPath(new URL("../../../",import.meta.url)));
const git=(a:string[])=>execFileSync("git",a,{cwd:repository,encoding:"utf8"}).trim();
if(git(["branch","--show-current"])!=="feat/p0-windows-login-install-readiness")
  throw Error("PREPROD_MAT003_BRANCH_REJECTED");
if(git(["status","--porcelain=v1"])!=="")
  throw Error("PREPROD_MAT003_WORKTREE_NOT_CLEAN");
const commit=git(["rev-parse","HEAD"]);
if(!/^[0-9a-f]{40}$/.test(commit))
  throw Error("PREPROD_MAT003_COMMIT_REJECTED");
function makeUrl(role:"pos_migrator"|"pos_platform_admin"):string{
  const u=new URL("postgresql://127.0.0.1:55435/camacho_pos_preprod");
  u.username=role;
  u.searchParams.set("sslmode","verify-full");
  u.searchParams.set("sslrootcert",ca);
  return u.toString();
}
const cfg:RoleReadinessConfig={
  provisioningUrl:makeUrl("pos_migrator"),
  verificationUrl:makeUrl("pos_platform_admin"),
  expectedDatabase:"camacho_pos_preprod",
  environmentId:"camacho-pos-windows-preprod",
  repositoryCommit:commit,
  receiptOutputPath:receipt,
};
const before=await checkRoleReadiness(cfg);
process.stdout.write("MAT003_BEFORE_CHECK: "+before.result+"\n");
process.stdout.write("MAT003_BEFORE_STATE: "+before.state+"\n");
if(before.result!=="PASS"||before.state!=="MISSING")
  throw Error("PREPROD_MAT003_STATE_NOT_SAFE_FOR_FIRST_APPLY");
process.stdout.write("MAT003_OFFICIAL_APPLY: STARTED\n");
const applied=await applyRoleReadiness(cfg);
process.stdout.write("MAT003_OFFICIAL_APPLY_RESULT: "+applied.result+"\n");
process.stdout.write("MAT003_OFFICIAL_APPLY_FAILURE_CODE: "+(applied.failure_code??"NONE")+"\n");
// Always re-check separately from the official response to detect commit
// without durable receipt and stop, rather than trying the GRANT again.
const after=await checkRoleReadiness(cfg);
process.stdout.write("MAT003_AFTER_CHECK: "+after.result+"\n");
process.stdout.write("MAT003_AFTER_STATE: "+after.state+"\n");
if(applied.result!=="READY_WITH_RECEIPT"||after.result!=="PASS"||after.state!=="READY")
  throw Error("PREPROD_MAT003_APPLY_OR_POSTCHECK_REQUIRES_MANUAL_REVIEW_NO_RETRY");
if(!existsSync(receipt))
  throw Error("PREPROD_MAT003_RECEIPT_NOT_ON_DISK_NO_RETRY");
const parsed=validateRoleReadinessReceipt(JSON.parse(readFileSync(receipt,"utf8")));
if(parsed.receipt_sha256!==applied.receipt_sha256||
   parsed.receipt_payload.repository_commit!==commit||
   parsed.receipt_payload.target.database_name!=="camacho_pos_preprod"||
   parsed.receipt_payload.target.environment_id!=="camacho-pos-windows-preprod"||
   parsed.receipt_payload.state_before!=="MISSING"||
   parsed.receipt_payload.state_after!=="READY")
  throw Error("PREPROD_MAT003_RECEIPT_VERIFICATION_FAILED_NO_RETRY");
process.stdout.write("MAT003_RECEIPT_INTEGRITY: PASS\n");
process.stdout.write("MAT003_PERMANENT_CANONICAL_ROLE_READINESS: PASS\n");
process.stdout.write("MIGRATION_003_NOT_APPLIED\n");
