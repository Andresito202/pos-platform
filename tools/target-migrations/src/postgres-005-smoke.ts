/**
 * Live PostgreSQL 005 row-level security smoke: real platform-app role.
 *
 * Creates disposable onboarding rows ONLY inside a transaction that always
 * ROLLBACKs. Checks actor-scoped reads/updates, denied cross-actor inserts,
 * global commercial-reference uniqueness and missing actor context. Never
 * modifies production data or claims that SQL app.actor_id is human auth.
 */
import {Pool, type PoolClient} from "pg";
import {uuidV7,MigrationInvariantError} from "./shared.js";

function invariant(value:unknown,message:string):asserts value{
  if(!value)throw new MigrationInvariantError(message);
}
function sqlstate(error:unknown):string|undefined{
  if(!error||typeof error!=="object")return undefined;
  const e=error as {code?:unknown;cause?:unknown};
  if(typeof e.code==="string")return e.code;
  if(e.cause!==error)return sqlstate(e.cause);
  return undefined;
}
async function expectBlocked(
  client:PoolClient,statement:string,params:unknown[],expectedState:string,
  label:string
):Promise<void>{
  await client.query("SAVEPOINT smoke_005_denied");
  let observed:string|undefined;
  try{await client.query(statement,params);}
  catch(error){observed=sqlstate(error);}
  finally{await client.query("ROLLBACK TO SAVEPOINT smoke_005_denied");await client.query("RELEASE SAVEPOINT smoke_005_denied");}
  invariant(observed===expectedState,"005 RLS smoke "+label+" expected SQLSTATE "+expectedState+" got "+(observed??"SUCCESS"));
}
export async function runPostgres005Smoke(adminUrl:string,expectedDatabase:string):Promise<number>{
  const url=new URL(adminUrl);
  url.username="pos_platform_app";
  url.password="";
  const pool=new Pool({connectionString:url.toString(),max:1});
  const client=await pool.connect();
  let started=false;
  let rolledBack=false;
  let assertions=0;
  const actorA=uuidV7(), actorB=uuidV7();
  const rowA=uuidV7(), rowB=uuidV7();
  const commercial="SMOKE005-"+uuidV7();
  const insert="INSERT INTO tenancy.onboarding_operations "+
    "(id,actor_type,actor_id,idempotency_key,request_checksum,correlation_id,"+
    "commercial_reference,status,created_at,updated_at,version) "+
    "VALUES ($1,'PLATFORM_ACCOUNT',$2,$3,$4,$5,$6,'IN_PROGRESS',"+
    "clock_timestamp(),clock_timestamp(),1)";
  try{
    const identity=(await client.query<{database:string;session_user:string;current_user:string}>(
      "SELECT current_database() database,session_user,current_user")).rows[0];
    invariant(identity?.database===expectedDatabase&&
      identity.current_user==="pos_platform_app"&&identity.session_user==="pos_platform_app",
      "005 RLS physical role/target mismatch");
    assertions++;
    await client.query("BEGIN");
    started=true;
    const catalog=(await client.query<{enabled:boolean;forced:boolean}>(
      "SELECT relrowsecurity enabled,relforcerowsecurity forced "+
      "FROM pg_class WHERE oid='tenancy.onboarding_operations'::regclass")).rows[0];
    invariant(catalog?.enabled&&catalog.forced,"005 RLS not enabled and forced");
    assertions++;
    const policies=(await client.query<{name:string;command:string}>(
      "SELECT polname name,polcmd command FROM pg_policy "+
      "WHERE polrelid='tenancy.onboarding_operations'::regclass")).rows;
    for(const [name,command] of [
      ["onboarding_operations_actor_select","r"],
      ["onboarding_operations_bootstrap_insert","a"],
      ["onboarding_operations_actor_update","w"],
    ]){
      invariant(policies.some(policy=>policy.name===name&&policy.command===command),
        "005 required policy/command mismatch: "+name);
      assertions++;
    }
    await client.query("SELECT set_config('app.actor_id',$1,true)",[actorA]);
    await client.query(insert,[rowA,actorA,"smoke-"+rowA,"a".repeat(64),uuidV7(),commercial]);
    assertions++;
    let selected=await client.query<{id:string}>(
      "SELECT id::text id FROM tenancy.onboarding_operations WHERE id=$1::uuid",[rowA]);
    invariant(selected.rows.length===1&&selected.rows[0]?.id===rowA,"005 actor A cannot read own row");
    assertions++;

    await client.query("SELECT set_config('app.actor_id',$1,true)",[actorB]);
    selected=await client.query<{id:string}>(
      "SELECT id::text id FROM tenancy.onboarding_operations WHERE id=$1::uuid",[rowA]);
    invariant(selected.rows.length===0,"005 cross-actor SELECT leak");
    assertions++;
    const update=await client.query(
      "UPDATE tenancy.onboarding_operations SET commercial_reference=$1 WHERE id=$2::uuid",
      [commercial+"-X",rowA]);
    invariant(update.rowCount===0,"005 cross-actor UPDATE leak");
    assertions++;
    await expectBlocked(client,insert,
      [uuidV7(),actorA,"smoke-cross-"+rowA,"b".repeat(64),uuidV7(),commercial+"-CROSS"],
      "42501","cross-actor insert");
    assertions++;
    await expectBlocked(client,insert,
      [rowB,actorB,"smoke-"+rowB,"c".repeat(64),uuidV7(),commercial],
      "23505","unique reference across actors");
    assertions++;
    await client.query(insert,[rowB,actorB,"smoke-"+rowB,"d".repeat(64),uuidV7(),commercial+"-B"]);
    assertions++;
    selected=await client.query<{id:string}>(
      "SELECT id::text id FROM tenancy.onboarding_operations WHERE id=$1::uuid",[rowB]);
    invariant(selected.rows.length===1&&selected.rows[0]?.id===rowB,"005 actor B cannot read own row");
    assertions++;

    await client.query("SELECT set_config('app.actor_id',$1,true)",[actorA]);
    selected=await client.query<{id:string}>(
      "SELECT id::text id FROM tenancy.onboarding_operations WHERE id=$1::uuid",[rowB]);
    invariant(selected.rows.length===0,"005 reverse cross-actor SELECT leak");
    assertions++;
    const ownUpdate=await client.query(
      "UPDATE tenancy.onboarding_operations SET commercial_reference=$1 WHERE id=$2::uuid",
      [commercial+"-A-UPDATED",rowA]);
    invariant(ownUpdate.rowCount===1,"005 actor A cannot update own commercial reference");
    assertions++;
    await client.query("SELECT set_config('app.actor_id','',true)");
    selected=await client.query<{id:string}>(
      "SELECT id::text id FROM tenancy.onboarding_operations WHERE id=$1::uuid",[rowA]);
    invariant(selected.rows.length===0,"005 missing actor context must be denied");
    assertions++;
    await expectBlocked(client,insert,
      [uuidV7(),actorA,"smoke-no-context-"+rowA,"e".repeat(64),uuidV7(),commercial+"-NOCTX"],
      "42501","missing actor context");
    assertions++;
  }finally{
    if(started){
      try{await client.query("ROLLBACK");rolledBack=true}
      catch{rolledBack=false}
    }
    client.release();
    await pool.end();
  }
  invariant(rolledBack,"005 RLS smoke rollback not confirmed");
  invariant(assertions===17,"005 RLS smoke assertion count mismatch");
  return assertions;
}
