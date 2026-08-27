import { executeRaw, postgresDatabase } from "./database.js";
import { MigrationInvariantError } from "./shared.js";

function roleUrl(adminUrl:string,role:string):string{
  const value=new URL(adminUrl);value.username=role;value.password="";return value.toString();
}
async function roleSelect(adminUrl:string,role:string,tenant:boolean):Promise<void>{
  const db=postgresDatabase(roleUrl(adminUrl,role),1);
  try{
    await db.transaction().execute(async transaction=>{
      if(tenant) await executeRaw(transaction,"SELECT set_config('app.tenant_id','018f3000-0000-7000-8000-000000000001',true)");
      await executeRaw(transaction,"SELECT id FROM fiscal.electronic_documents LIMIT 1");
    });
  }finally{await db.destroy();}
}

export async function runPostgres003Smoke(adminUrl:string):Promise<number>{
  let assertions=0;
  for(const [role,tenant] of [["pos_app",true],["pos_worker",true],["pos_platform_app",true],["pos_platform_admin",false]] as const){
    try{await roleSelect(adminUrl,role,tenant);assertions+=1;}
    catch(error){throw new MigrationInvariantError(`003 smoke SELECT failed for ${role}: ${error instanceof Error?error.message:"unknown"}`);}
  }
  const reporting=postgresDatabase(adminUrl,1);
  try{
    const result=await reporting.introspection.getTables().catch(()=>[]);
    void result;
  }finally{await reporting.destroy();}
  return assertions;
}
