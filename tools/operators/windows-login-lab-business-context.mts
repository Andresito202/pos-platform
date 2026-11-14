/** Owner-approved local laboratory bootstrap. Not an authentication endpoint. */
import {createHash, X509Certificate} from "node:crypto";
import {execFileSync} from "node:child_process";
import {readFileSync,lstatSync,realpathSync,writeFileSync} from "node:fs";
import {join,resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {CANONICAL_PERMISSION_CODES,UuidSchema,uuidV7} from "../../packages/contracts/src/index.js";
import {createPostgresPool,PostgresOnboardingRepository,type Pool,type PoolClient} from "../../packages/database-postgres/src/index.js";

export const LAB_ADMIN_POLICY=Object.freeze({
  reference:"CAMACHO_LAB_GENERAL_ADMIN_OWNER_APPROVED_2026_11_04_V1",
  company:"Camacho POS Laboratorio",branch:"Principal",role:"GENERAL_ADMIN",
  permissions:Object.freeze([
    "SALES_SALE_CREATE","SALES_RECEIPT_READ","INVENTORY_STOCK_READ","INVENTORY_STOCK_RECEIVE","INVENTORY_STOCK_ADJUST",
    "CATALOG_PRODUCT_READ","CATALOG_PRODUCT_REGISTER","CUSTOMERS_CUSTOMER_READ","CUSTOMERS_CUSTOMER_REGISTER",
    "PAYMENTS_PAYMENT_READ","PAYMENTS_PAYMENT_REGISTER","PAYMENTS_PAYMENT_CANCEL","PAYMENTS_TRANSFER_REPORT",
    "PAYMENTS_TRANSFER_CONFIRM","CASH_SHIFT_OPEN","CASH_SHIFT_CLOSE","AUDIT_EVENT_READ",
  ]),
});
const action="LAB_BUSINESS_ADMIN_PUBLISHED";
const checksum=createHash("sha256").update(JSON.stringify(LAB_ADMIN_POLICY)).digest("hex");
type Selector={userId:string;factorId:string;materialId:string};
type Context=Selector & {tenantId:string;companyId:string;branchId:string;membershipId:string;roleId:string;assignmentId:string};
type Result={outcome:"CREATED"|"UNCHANGED"|"VERIFIED_ROLLED_BACK";context:Context;permissionCount:number;businessSessionIssued:false};
class VerifiedRollback extends Error {constructor(readonly result:Result,readonly existed:boolean){super("LAB_VERIFY_ROLLBACK");}}
const fail=(code:string):never=>{throw Error(code);};
const sameSet=(a:readonly string[],b:readonly string[])=>a.length===b.length&&[...a].sort().every((v,i)=>v===[...b].sort()[i]);

/** Internal operator function: DB authority comes from the guarded local CLI,
 * not from selector UUIDs or the enrollment receipt. Never creates a session. */
export async function provisionLabAdministrator(pool:Pool,selector:Selector,options:{verifyOnly:boolean;lockTimeoutMs:number;operatorSid:string}):Promise<Result>{
  for(const v of Object.values(selector))UuidSchema.parse(v);
  if(!Number.isInteger(options.lockTimeoutMs)||options.lockTimeoutMs<1||options.lockTimeoutMs>30000)fail("LAB_EXPLICIT_LOCK_TIMEOUT_REQUIRED");
  if(!/^S-1-5-(?:\d+-)*\d+$/.test(options.operatorSid??""))fail("LAB_OPERATOR_AUDIT_IDENTITY_REQUIRED");
  if(LAB_ADMIN_POLICY.permissions.some(p=>!(CANONICAL_PERMISSION_CODES as readonly string[]).includes(p)))fail("LAB_PERMISSION_CONTRACT_CHANGED");
  let client:PoolClient;
  // The canonical repository owns BEGIN/COMMIT/ROLLBACK/release. Its existing
  // tenant/company/branch writers are reused; OWNER-only onboarding is not run.
  const repository=new PostgresOnboardingRepository({connect:async()=>client=await pool.connect()});
  try{return await repository.transaction(async tx=>{
    const c=client!;
    await c.query("SELECT set_config('lock_timeout',$1,true)",[options.lockTimeoutMs+"ms"]);
    await c.query(`LOCK TABLE tenancy.tenants,organization.companies,organization.branches,tenancy.tenant_memberships,
      "authorization".roles,"authorization".permissions,"authorization".role_permission_grants,
      "authorization".user_role_assignments IN SHARE ROW EXCLUSIVE MODE`);
    const db=await c.query("SELECT current_database() AS db,current_setting('server_version') AS version,(SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()) AS tls");
    if(db.rows[0]?.db!=="camacho_windows_login_lab"||!/^16\.14(?:\D|$)/.test(db.rows[0]?.version??"")||db.rows[0]?.tls!==true)fail("ISOLATED_TLS_POSTGRES_16_14_REQUIRED");
    const identity=await c.query(`SELECT u.id FROM identity.users u
      JOIN identity.user_credentials p ON p.user_id=u.id AND p.credential_type='PASSWORD' AND p.status='ACTIVE' AND p.revoked_at IS NULL
        AND (p.locked_until IS NULL OR p.locked_until<=clock_timestamp())
      JOIN identity.mfa_factors f ON f.user_id=u.id AND f.id=$2 AND f.factor_type='WEBAUTHN' AND f.status='ACTIVE'
        AND f.verified_at IS NOT NULL AND f.revoked_at IS NULL
      JOIN identity.webauthn_credential_material m ON m.factor_id=f.id AND m.id=$3 AND f.secret_reference='webauthn:v1:'||m.id::text
      WHERE u.id=$1 AND u.status='ACTIVE' FOR SHARE OF u,p,f,m`,[selector.userId,selector.factorId,selector.materialId]);
    if(identity.rows.length!==1)fail("LAB_ACTIVE_HUMAN_ACCOUNT_AND_FACTOR_REQUIRED");
    const receipt=await c.query(`SELECT new_value FROM audit.audit_events WHERE action_code=$1 ORDER BY server_recorded_at DESC LIMIT 2`,[action]);
    let context:Context;
    if(receipt.rows.length){
      const payload=receipt.rows[0].new_value;
      if(receipt.rows.length!==1||payload?.policyChecksum!==checksum||!payload.context||
        payload.context.userId!==selector.userId||payload.context.factorId!==selector.factorId||payload.context.materialId!==selector.materialId)fail("LAB_EXISTING_PUBLICATION_CONFLICT");
      context=payload.context;
      for(const v of Object.values(context))UuidSchema.parse(v);
    }else{
      const initial=await c.query(`SELECT (SELECT count(*)::int FROM identity.users) AS users,
        (SELECT count(*)::int FROM tenancy.tenants) AS tenants,(SELECT count(*)::int FROM organization.companies) AS companies,
        (SELECT count(*)::int FROM organization.branches) AS branches,(SELECT count(*)::int FROM tenancy.tenant_memberships) AS memberships,
        (SELECT count(*)::int FROM "authorization".roles WHERE scope_type='BUSINESS') AS roles`);
      const counts=initial.rows[0];
      if(counts?.users!==1||["tenants","companies","branches","memberships","roles"].some(k=>counts?.[k]!==0))fail("LAB_INITIAL_CONTEXT_NOT_EMPTY_REVIEW_REQUIRED");
      context={...selector,tenantId:uuidV7(),companyId:uuidV7(),branchId:uuidV7(),membershipId:uuidV7(),roleId:uuidV7(),assignmentId:uuidV7()};
      await tx.setTenantContext(context.tenantId);
      await tx.createTenant({id:context.tenantId,name:LAB_ADMIN_POLICY.company});
      await tx.createCompany({id:context.companyId,tenantId:context.tenantId,name:LAB_ADMIN_POLICY.company,timezone:"America/Bogota",currency:"COP"});
      await tx.createBranch({id:context.branchId,tenantId:context.tenantId,companyId:context.companyId,name:LAB_ADMIN_POLICY.branch,timezone:"America/Bogota"});
      await c.query(`INSERT INTO tenancy.tenant_memberships
        (id,tenant_id,user_id,membership_type,status,is_primary,created_by_actor_type,created_at,activated_at,version)
        VALUES($1,$2,$3,'ADMIN','ACTIVE',true,'SYSTEM',clock_timestamp(),clock_timestamp(),1)`,[context.membershipId,context.tenantId,selector.userId]);
      await c.query(`INSERT INTO "authorization".roles(id,code,name,scope_type,version,status,created_at)
        VALUES($1,$2,'Administrador del laboratorio','BUSINESS',1,'ACTIVE',clock_timestamp())`,[context.roleId,LAB_ADMIN_POLICY.role]);
      for(const code of LAB_ADMIN_POLICY.permissions){
        const existing=await c.query(`SELECT id,status FROM "authorization".permissions WHERE code=$1 FOR SHARE`,[code]);
        if(existing.rows.length>1||existing.rows.length===1&&existing.rows[0].status!=="ACTIVE")fail("LAB_PERMISSION_PUBLICATION_CONFLICT");
        let id=existing.rows[0]?.id;
        if(!id){id=uuidV7();await c.query(`INSERT INTO "authorization".permissions(id,code,module,description,status,created_at)
          VALUES($1,$2,$3,$4,'ACTIVE',clock_timestamp())`,[id,code,code.split("_")[0],"Permiso canónico autorizado para laboratorio: "+code]);}
        await c.query(`INSERT INTO "authorization".role_permission_grants(id,role_id,permission_id,grant_version,status,valid_from,created_at)
          VALUES($1,$2,$3,1,'ACTIVE',clock_timestamp(),clock_timestamp())`,[uuidV7(),context.roleId,id]);
      }
      await c.query(`INSERT INTO "authorization".user_role_assignments
        (id,tenant_id,tenant_membership_id,role_id,company_id,branch_id,status,valid_from,created_at,created_by_actor_type,version)
        VALUES($1,$2,$3,$4,$5,$6,'ACTIVE',clock_timestamp(),clock_timestamp(),'SYSTEM',1)`,
        [context.assignmentId,context.tenantId,context.membershipId,context.roleId,context.companyId,context.branchId]);
      const payload=JSON.stringify({policyChecksum:checksum,policy:LAB_ADMIN_POLICY,context,operatorSid:options.operatorSid,authenticationEvidence:false});
      await c.query(`INSERT INTO audit.audit_events
        (id,tenant_id,company_id,branch_id,actor_type,action_code,resource_type,resource_reference_kind,resource_id,
         correlation_id,schema_version,reported_at,server_recorded_at,result,new_value,payload_checksum)
        VALUES($1,$2,$3,$4,'SYSTEM',$5,'LAB_BUSINESS_CONTEXT','INSTANCE',$3,$6,1,clock_timestamp(),clock_timestamp(),
        'SUCCEEDED',$7::jsonb,encode(sha256(convert_to($7::jsonb::text,'UTF8')),'hex'))`,
        [uuidV7(),context.tenantId,context.companyId,context.branchId,action,uuidV7(),payload]);
    }
    await tx.setTenantContext(context.tenantId);
    const binding=await c.query(`SELECT a.id FROM "authorization".user_role_assignments a
      JOIN tenancy.tenant_memberships m ON m.id=a.tenant_membership_id AND m.tenant_id=a.tenant_id AND m.user_id=$2
        AND m.membership_type='ADMIN' AND m.status='ACTIVE' AND m.suspended_at IS NULL AND m.revoked_at IS NULL
      JOIN tenancy.tenants t ON t.id=m.tenant_id AND t.status='ACTIVE' AND t.name=$9
      JOIN organization.companies co ON co.id=a.company_id AND co.tenant_id=m.tenant_id AND co.status='ACTIVE' AND co.trade_name=$9
      JOIN organization.branches b ON b.id=a.branch_id AND b.company_id=co.id AND b.tenant_id=m.tenant_id AND b.status='ACTIVE' AND b.name=$10
      JOIN "authorization".roles r ON r.id=a.role_id AND r.code=$8 AND r.scope_type='BUSINESS' AND r.status='ACTIVE' AND r.version=1
      WHERE a.id=$1 AND a.tenant_id=$3 AND a.company_id=$4 AND a.branch_id=$5 AND a.role_id=$6 AND a.tenant_membership_id=$7
      AND a.status='ACTIVE' AND a.revoked_at IS NULL AND a.valid_from<=clock_timestamp() AND (a.valid_until IS NULL OR a.valid_until>clock_timestamp())
      AND NOT EXISTS(SELECT 1 FROM "authorization".user_role_assignments other WHERE other.tenant_membership_id=m.id
        AND other.tenant_id=m.tenant_id AND other.id<>a.id AND other.status='ACTIVE' AND other.revoked_at IS NULL
        AND other.valid_from<=clock_timestamp() AND (other.valid_until IS NULL OR other.valid_until>clock_timestamp()))`,
      [context.assignmentId,selector.userId,context.tenantId,context.companyId,context.branchId,context.roleId,context.membershipId,LAB_ADMIN_POLICY.role,LAB_ADMIN_POLICY.company,LAB_ADMIN_POLICY.branch]);
    const grants=await c.query(`SELECT p.code FROM "authorization".role_permission_grants g
      JOIN "authorization".permissions p ON p.id=g.permission_id AND p.status='ACTIVE'
      WHERE g.role_id=$1 AND g.status='ACTIVE' AND g.valid_from<=clock_timestamp()
      AND (g.valid_until IS NULL OR g.valid_until>clock_timestamp())`,[context.roleId]);
    if(binding.rows.length!==1||!sameSet(grants.rows.map(r=>r.code),LAB_ADMIN_POLICY.permissions))fail("LAB_PUBLISHED_SCOPE_OR_GRANTS_MISMATCH");
    const result:Result={outcome:receipt.rows.length?"UNCHANGED":"CREATED",context,permissionCount:17,businessSessionIssued:false};
    if(options.verifyOnly)throw new VerifiedRollback({...result,outcome:"VERIFIED_ROLLED_BACK"},receipt.rows.length===1);
    return result;
  });}catch(error){
    if(!(error instanceof VerifiedRollback))throw error;
    // Independently confirm rollback after the repository has released its
    // transaction; a failed ROLLBACK must never be reported as verification.
    const check=await pool.connect();
    try{
      const id=error.result.context;
      const r=await check.query(`SELECT (SELECT count(*)::int FROM "authorization".roles WHERE id=$1) AS roles,
        (SELECT count(*)::int FROM organization.companies WHERE id=$2) AS companies,
        (SELECT count(*)::int FROM tenancy.tenant_memberships WHERE id=$3) AS memberships,
        (SELECT count(*)::int FROM audit.audit_events WHERE action_code=$4 AND resource_id=$2) AS audits`,[id.roleId,id.companyId,id.membershipId,action]);
      const expected=error.existed?1:0;
      if(!r.rows[0]||["roles","companies","memberships","audits"].some(k=>r.rows[0][k]!==expected))fail("LAB_ROLLBACK_POSTCONDITION_FAILED");
      return error.result;
    }finally{check.release();}
  }
}

function ownedFile(file:string){
  const s=lstatSync(file);if(!s.isFile()||s.isSymbolicLink()||s.size>1048576||resolve(realpathSync(file)).toLowerCase()!==resolve(file).toLowerCase())fail("LAB_FILE_REJECTED");
  return readFileSync(file);
}
export function parseLabArguments(args:readonly string[]){
  const mode=args[0];if(!["--verify-transaction","--apply"].includes(mode??""))fail("LAB_EXPLICIT_ACTION_REQUIRED");
  if(args.length!==5||args[1]!=="--lab-root"||args[3]!=="--lock-timeout-ms")fail("LAB_ARGUMENTS_REJECTED");
  const root=args[2],timeout=Number(args[4]);
  if(!/^C:\\CamachoPosScmLab\\[a-f0-9]{32}$/.test(root??"")||resolve(root!)!==root||!Number.isInteger(timeout)||timeout<1||timeout>30000)fail("LAB_SCOPE_OR_TIMEOUT_REJECTED");
  return {root:root!,timeout,verifyOnly:mode==="--verify-transaction"};
}
async function main(){
  const input=parseLabArguments(process.argv.slice(2));
  if(process.platform!=="win32")fail("LAB_WINDOWS_OPERATOR_REQUIRED");
  const operator=execFileSync("powershell.exe",["-NoProfile","-NonInteractive","-Command",
    "$i=[Security.Principal.WindowsIdentity]::GetCurrent();$p=[Security.Principal.WindowsPrincipal]::new($i);if(-not $i.IsAuthenticated -or $i.IsSystem -or [Diagnostics.Process]::GetCurrentProcess().SessionId -le 0 -or -not $p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){exit 1};Write-Output ('LAB_OPERATOR_VERIFIED|'+$i.User.Value)"],
    {encoding:"utf8",windowsHide:true,timeout:15000}).trim();
  const operatorSid=/^LAB_OPERATOR_VERIFIED\|(S-1-5-(?:\d+-)*\d+)$/.exec(operator)?.[1];
  if(!operatorSid)fail("LAB_WINDOWS_OPERATOR_REQUIRED");
  const directory=join(input.root,"central-lab"),state=JSON.parse(ownedFile(join(directory,"database-state.json")).toString("utf8"));
  if(state.profile!=="CAMACHO_WINDOWS_LOGIN_LAB_ONLY"||state.database!=="camacho_windows_login_lab"||state.host!=="127.0.0.1"||state.port!==55433)fail("LAB_DATABASE_SCOPE_REJECTED");
  const selected=JSON.parse(ownedFile(join(directory,"human-enrollment.json")).toString("utf8"));
  // Selection only, never accepted as proof of MFA or an authenticated session.
  const selector={userId:UuidSchema.parse(selected.userId),factorId:UuidSchema.parse(selected.factorId),materialId:UuidSchema.parse(selected.materialId)};
  const ca=join(directory,"tls","lab-root.crt"),certificate=new X509Certificate(ownedFile(ca));
  if(!certificate.ca||!certificate.subject.includes("NOT PRODUCTION")||Date.parse(certificate.validTo)<=Date.now())fail("LAB_CA_REJECTED");
  const url=new URL("postgresql://postgres@postgres.camacho-pos.local:55433/camacho_windows_login_lab");
  url.password=ownedFile(join(directory,"postgres-password.txt")).toString("utf8").trim();
  url.searchParams.set("sslmode","verify-full");url.searchParams.set("sslrootcert",ca);
  const pool=createPostgresPool(url.href,1,"windows-lab-approved-business-context");
  try{
    const result=await provisionLabAdministrator(pool,selector,{verifyOnly:input.verifyOnly,lockTimeoutMs:input.timeout,operatorSid:operatorSid!});
    const receiptFile=join(directory,"business-context-"+uuidV7()+".json");
    writeFileSync(receiptFile,JSON.stringify({profile:"CAMACHO_LAB_APPROVED_BUSINESS_CONTEXT",...result,policyChecksum:checksum,completedAt:new Date().toISOString()},null,2),{flag:"wx"});
    console.log(JSON.stringify({outcome:result.outcome,company:LAB_ADMIN_POLICY.company,branch:LAB_ADMIN_POLICY.branch,role:LAB_ADMIN_POLICY.role,
      permissionCount:result.permissionCount,businessSessionIssued:false,receiptFile}));
  }finally{await pool.end();}
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
  main().catch((error:unknown)=>{
    const candidate=error instanceof Error?error.message:"";
    const sqlState=typeof error==="object"&&error!==null&&"code" in error?String(error.code):"";
    const code=/^(?:LAB_|ISOLATED_)[A-Z0-9_]+$/.test(candidate)?candidate:/^[A-Z0-9]{5}$/.test(sqlState)?"POSTGRES_"+sqlState:"DETAILS_REDACTED";
    console.error("LAB_BUSINESS_CONTEXT_FAILED_NO_SESSION: "+code);process.exitCode=1;
  });
}
