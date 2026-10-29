/**
 * Read-only Windows PostgreSQL role gate for Camacho POS preproduction.
 * Uses node-postgres / pgpass + TLS verify-full and the pinned server CA.
 * Never logs passwords, URLs or filesystem paths; never mutates SQL.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";

const root=process.env.LOCALAPPDATA;
if(process.platform!=="win32"||!root)throw Error("PREPROD_GATE_REQUIRES_WINDOWS");
const dir=join(root,"CamachoPOS","preprod");
const passfile=join(dir,"pgpass.conf"),ca=join(dir,"pg-server-ca.crt");
if(!existsSync(passfile)||!existsSync(ca))throw Error("PREPROD_PROTECTED_MATERIAL_MISSING");
if(process.env.PGPASSWORD!==undefined)throw Error("PREPROD_GENERIC_PASSWORD_ENV_NOT_ALLOWED");
process.env.PGPASSFILE=passfile;

function connection(role:string,override?:string):Client {
  const url=new URL("postgresql://127.0.0.1:55435/camacho_pos_preprod");
  url.username=role;
  url.searchParams.set("sslmode","verify-full");
  url.searchParams.set("sslrootcert",ca);
  return new Client({
    connectionString:url.toString(),
    connectionTimeoutMillis:8000,
    ...(override?{password:override}:{}),
  });
}
const roles=[
  {name:"pos_migrator",bypass:false},
  {name:"pos_app",bypass:false},
  {name:"pos_worker",bypass:false},
  {name:"pos_platform_app",bypass:false},
  {name:"pos_platform_admin",bypass:true},
] as const;
for(const role of roles){
  const client=connection(role.name);
  try{
    await client.connect();
    const check=await client.query<{
      db:string;identity:string;ssl:boolean;tls_version:string|null;
      canlogin:boolean;superuser:boolean;bypassrls:boolean;createdb:boolean;createrole:boolean;
    }>("SELECT current_database() AS db,current_user AS identity,"+
        " (SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()) AS ssl,"+
        " (SELECT version FROM pg_stat_ssl WHERE pid=pg_backend_pid()) AS tls_version,"+
        " r.rolcanlogin AS canlogin,r.rolsuper AS superuser,"+
        " r.rolbypassrls AS bypassrls,r.rolcreatedb AS createdb,r.rolcreaterole AS createrole"+
        " FROM pg_roles r WHERE r.rolname=current_user");
    const r=check.rows[0];
    if(check.rows.length!==1||!r||r.db!=="camacho_pos_preprod"||
       r.identity!==role.name||r.ssl!==true||
       !["TLSv1.2","TLSv1.3"].includes(r.tls_version??"")||
       r.canlogin!==true||r.superuser!==false||
       r.bypassrls!==role.bypass||r.createdb!==false||r.createrole!==false){
      throw Error("PREPROD_ROLE_OR_TLS_INVARIANT_REJECTED");
    }
    process.stdout.write("ROLE "+role.name+": SCRAM_TLS_AND_PRIVILEGES_PASS\n");
  }finally{
    await client.end().catch(()=>undefined);
  }
}
let wrongAccepted=false;
const invalid=connection("pos_platform_app","CAMACHO_INVALID_CREDENTIAL_NEGATIVE_TEST");
try{
  await invalid.connect();
  wrongAccepted=true;
}catch{
  // Auth refusal is intentional. No server errors/credentials are logged.
}finally{
  await invalid.end().catch(()=>undefined);
}
if(wrongAccepted)throw Error("PREPROD_WRONG_PASSWORD_WAS_ACCEPTED");
process.stdout.write("WRONG_PASSWORD_DENIED: PASS\n");
process.stdout.write("ROLE_GATE: PASS (no migrations or commercial login executed)\n");
