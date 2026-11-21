import {createPostgresPool} from "@pos-platform/database-postgres";
import {uuidV7} from "@pos-platform/contracts";
import {BusinessCashRegisters} from "../../src/business-cash-registers.js";
import {requireActiveBoundRegisters} from "../../src/cash-register-license-binding.js";

const connection=process.env.CASH_BINDING_PROBE_URL;
if(!connection)throw Error("DISPOSABLE_TEST_SERVER_REQUIRED");
const url=new URL(connection);
if(url.hostname!=="127.0.0.1"||["5432","55433",""].includes(url.port)||!/^\/test_cash_binding_[a-f0-9]+$/.test(url.pathname))throw Error("DISPOSABLE_TEST_SERVER_REQUIRED");
const f=JSON.parse(process.argv[2]!) as {tenantId:string;companyId:string;branchId:string;licenseId:string;otherLicenseId:string;sessionId:string;userId:string;membershipId:string};
const pool=createPostgresPool(connection,2);
const useCase=new BusinessCashRegisters({profile:"CAMACHO_LICENSE_ACTIVATION_V1",policy_reference:"TEST_ONLY",subscription_grace_days:3,
  grace_basis:"ELAPSED_24_HOURS",perpetual_use:"NO_EXPIRY",support_and_external_services:"SEPARATE",accepted_contract_policy_references:["TEST_ONLY"],offline_capabilities:["CASH_REGISTER"]});
const session={sessionId:f.sessionId,userId:f.userId,tenantId:f.tenantId,membershipId:f.membershipId};
async function execute(operation:string,body:unknown){
  const c=await pool.connect();try{await c.query("BEGIN");await c.query("SELECT set_config('app.tenant_id',$1,true),set_config('lock_timeout','5s',true),set_config('statement_timeout','15s',true)",[f.tenantId]);
    const result=await useCase.execute(c,session,operation,body);await c.query("COMMIT");return result;
  }catch(e){await c.query("ROLLBACK");throw e;}finally{c.release();}
}
async function rejects(operation:string,input:unknown,code:string){try{await execute(operation,input);}catch(e){if(e instanceof Error&&e.message===code)return true;throw e;}throw Error("EXPECTED_REJECTION_MISSING");}
try{
  const scope={companyId:f.companyId,branchId:f.branchId,licenseId:f.licenseId};
  const request={...scope,id:uuidV7(),code:"PROBE",name:"Test only",currency:"COP",correlationId:uuidV7()};
  const created=await execute("create",request);
  const replay=await execute("create",request);
  if(JSON.stringify(created)!==JSON.stringify(replay))throw Error("CREATE_ACK_CHANGED");
  const staleVersion=await rejects("edit",{...scope,id:request.id,expectedVersion:2,code:"PROBE",name:"Edit",correlationId:uuidV7()},"CASH_REGISTER_VERSION_CONFLICT");
  const otherLicense=await rejects("retire",{...scope,licenseId:f.otherLicenseId,id:request.id,expectedVersion:1,correlationId:uuidV7()},"CASH_REGISTER_LICENSE_BINDING_CONFLICT");
  await execute("edit",{...scope,id:request.id,expectedVersion:1,code:"PROBE",name:"Edited",correlationId:uuidV7()});
  await execute("retire",{...scope,id:request.id,expectedVersion:2,correlationId:uuidV7()});
  const page=await execute("list",{...scope,after:null});
  const c=await pool.connect();let retiredActivationRejected=false;try{
    await c.query("BEGIN");await c.query("SELECT set_config('app.tenant_id',$1,true)",[f.tenantId]);
    try{await requireActiveBoundRegisters(c,{tenantId:f.tenantId,companyId:f.companyId,licenseId:f.licenseId},[{register_id:request.id,branch_id:f.branchId}]);}
    catch(e){if(e instanceof Error&&e.message==="LICENSE_ACTIVE_BOUND_REGISTER_REQUIRED")retiredActivationRejected=true;else throw e;}
    if(!retiredActivationRejected)throw Error("RETIRED_REGISTER_ACCEPTED_FOR_NEW_SIGNATURE");
    const register=(await c.query("SELECT status,version FROM cash.cash_registers WHERE id=$1",[request.id])).rows[0];
    const audit=(await c.query("SELECT action_code FROM audit.audit_events WHERE resource_id=$1 ORDER BY server_recorded_at,id",[request.id])).rows;
    if(register?.status!=="RETIRED"||Number(register.version)!==3||audit.length!==3)throw Error("ATOMIC_MASTER_AUDIT_HISTORY_MISSING");
    await c.query("COMMIT");
  }catch(e){await c.query("ROLLBACK");throw e;}finally{c.release();}
  if(!("registers" in page)||!page.registers.some(r=>r.id===request.id&&r.status==='RETIRED'))throw Error("RETIRED_MASTER_NOT_LISTED");
  if(JSON.stringify(await execute("create",request))!==JSON.stringify(created))throw Error("HISTORICAL_ACK_CHANGED");
  process.stdout.write(JSON.stringify({created:true,replayed:true,staleVersion,otherLicense,edited:true,retired:true,audited:true,retiredActivationRejected}));
}finally{await pool.end();}
