import type { SqlExecutor } from "./database.js";
import { queryRows } from "./database.js";
import {
  FISCAL_TABLES,
  INTEGRATION_TABLES,
  POSTGRES_003_DESCRIPTOR,
  POSTGRES_TABLE_COLUMNS,
  TARGET_SCHEMAS,
} from "./contract.js";
import { MigrationInvariantError } from "./shared.js";

type GrantEntry={select:readonly string[];insert:readonly string[];update:readonly string[]};
type GrantMatrix=Record<string,Record<string,GrantEntry>>;
const RUNTIME_ROLES=["pos_app","pos_worker","pos_platform_app","pos_platform_admin","pos_reporting"] as const;

function invariant(value:unknown,message:string):asserts value{
  if(!value) throw new MigrationInvariantError(message);
}
function same(left:readonly string[],right:readonly string[]):boolean{
  return left.length===right.length&&left.every((value,index)=>value===right[index]);
}
function sqlList(values:readonly string[]):string{
  return values.map(value=>`'${value.replaceAll("'","''")}'`).join(",");
}
function expectedGrantKeys(matrix:GrantMatrix):string[]{
  const keys:string[]=[];
  for(const [table,byRole] of Object.entries(matrix)){
    const [schema,tableName]=table.split(".");
    for(const role of RUNTIME_ROLES){
      const entry=byRole[role];
      if(!entry) continue;
      for(const [privilege,key] of [["SELECT","select"],["INSERT","insert"],["UPDATE","update"]] as const){
        for(const column of entry[key]) keys.push(`${schema}|${tableName}|${column}|${role}|${privilege}`);
      }
    }
  }
  return keys.sort();
}

async function validate001FoundationShape(db:SqlExecutor):Promise<void>{
  const expectedSchemas=["platform",...TARGET_SCHEMAS].sort();
  const schemas=await queryRows<{name:string}>(db,`
    SELECT nspname name FROM pg_namespace
    WHERE nspname IN (${sqlList(expectedSchemas)}) ORDER BY nspname
  `);
  invariant(same(schemas.map(row=>row.name),expectedSchemas),"003 predecessor 001 schema set diverges");

  for(const [qualified,expected] of Object.entries(POSTGRES_TABLE_COLUMNS)){
    const [schemaName,tableName]=qualified.split(".");
    const columns=await queryRows<{name:string}>(db,`
      SELECT column_name name FROM information_schema.columns
      WHERE table_schema='${schemaName}' AND table_name='${tableName}'
      ORDER BY ordinal_position
    `);
    invariant(same(columns.map(row=>row.name),[...expected]),`003 predecessor 001 columns diverge for ${qualified}`);
  }
}

export async function fiscal003CatalogState(db:SqlExecutor):Promise<"pre-003"|"target-003"|"partial">{
  const row=(await queryRows<{schema_exists:boolean;fiscal_tables:string}>(db,`
    SELECT to_regnamespace('fiscal') IS NOT NULL schema_exists,
      (SELECT count(*)::text FROM pg_tables WHERE schemaname='fiscal') fiscal_tables
  `))[0];
  if(!row?.schema_exists&&row?.fiscal_tables==="0") return "pre-003";
  if(row?.schema_exists&&Number(row.fiscal_tables)===FISCAL_TABLES.length){
    try{await validatePostgres003Catalog(db);return "target-003";}catch{return "partial";}
  }
  return "partial";
}

export async function validatePostgres003Catalog(db:SqlExecutor):Promise<void>{
  await validate001FoundationShape(db);

  const extension=(await queryRows<{present:boolean}>(db,"SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname='btree_gist') present"))[0];
  invariant(extension?.present,"003 requires btree_gist");

  const schema=(await queryRows<{owner:string}>(db,"SELECT pg_get_userbyid(nspowner) owner FROM pg_namespace WHERE nspname='fiscal'"))[0];
  invariant(schema?.owner==="pos_schema_owner","003 fiscal schema owner diverges");

  const tables=await queryRows<{name:string;owner:string;rls:boolean;forced:boolean}>(db,`
    SELECT c.relname name,pg_get_userbyid(c.relowner) owner,c.relrowsecurity rls,c.relforcerowsecurity forced
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='fiscal' AND c.relkind='r' ORDER BY c.relname
  `);
  invariant(same(tables.map(row=>row.name),[...FISCAL_TABLES].sort()),"003 fiscal table set diverges");
  invariant(tables.every(row=>row.owner==="pos_schema_owner"&&row.rls&&row.forced),"003 fiscal owner/RLS diverges");

  for(const [qualified,expected] of Object.entries(POSTGRES_003_DESCRIPTOR.expectedTableColumns)){
    const [schemaName,tableName]=qualified.split(".");
    const columns=await queryRows<{name:string}>(db,`
      SELECT column_name name FROM information_schema.columns
      WHERE table_schema='${schemaName}' AND table_name='${tableName}' ORDER BY ordinal_position
    `);
    invariant(same(columns.map(row=>row.name),[...expected]),`003 columns diverge for ${qualified}`);
  }

  const integrationTables=await queryRows<{name:string}>(db,"SELECT tablename name FROM pg_tables WHERE schemaname='integrations' ORDER BY tablename");
  invariant(INTEGRATION_TABLES.every(name=>integrationTables.some(row=>row.name===name)),"003 predecessor integration table missing");

  for(const [qualified,columns] of Object.entries(POSTGRES_003_DESCRIPTOR.integrationExtensionColumns)){
    const [schemaName,tableName]=qualified.split(".");
    const actual=await queryRows<{name:string}>(db,`
      SELECT column_name name FROM information_schema.columns
      WHERE table_schema='${schemaName}' AND table_name='${tableName}'
        AND column_name IN (${sqlList(columns)}) ORDER BY column_name
    `);
    invariant(same(actual.map(row=>row.name),[...columns].sort()),`003 integration extension columns diverge for ${qualified}`);
  }

  const constraints=POSTGRES_003_DESCRIPTOR.ownedConstraints as readonly string[];
  const actualConstraints=await queryRows<{name:string}>(db,`
    SELECT conname name FROM pg_constraint WHERE conname IN (${sqlList(constraints)}) ORDER BY conname
  `);
  invariant(same(actualConstraints.map(row=>row.name),[...constraints].sort()),"003 owned constraint set diverges");

  const indexes=POSTGRES_003_DESCRIPTOR.ownedIndexes as readonly string[];
  const actualIndexes=await queryRows<{name:string}>(db,`
    SELECT indexname name FROM pg_indexes WHERE indexname IN (${sqlList(indexes)}) ORDER BY indexname
  `);
  invariant(same(actualIndexes.map(row=>row.name),[...indexes].sort()),"003 owned index set diverges");

  const guards=POSTGRES_003_DESCRIPTOR.expectedGuards as readonly string[];
  const actualGuards=await queryRows<{name:string}>(db,`
    SELECT t.tgname name FROM pg_trigger t
    WHERE NOT t.tgisinternal AND t.tgname IN (${sqlList(guards)}) ORDER BY t.tgname
  `);
  invariant(same(actualGuards.map(row=>row.name),[...guards].sort()),"003 guard set diverges");

  const policies=await queryRows<{name:string}>(db,"SELECT policyname name FROM pg_policies WHERE schemaname='fiscal' ORDER BY policyname");
  invariant(same(policies.map(row=>row.name),[...(POSTGRES_003_DESCRIPTOR.ownedPolicies as readonly string[])].sort()),"003 policy set diverges");

  const functions=await queryRows<{name:string;security_definer:boolean}>(db,`
    SELECT p.proname name,p.prosecdef security_definer
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='fiscal' ORDER BY p.proname
  `);
  invariant(same(functions.map(row=>row.name),[...POSTGRES_003_DESCRIPTOR.ownedFunctions].sort()),"003 function set diverges");
  invariant(functions.every(row=>!row.security_definer),"003 SECURITY DEFINER is prohibited");

  const publicFunctionGrants=await queryRows<{count:string}>(db,`
    SELECT count(*)::text count
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a
    WHERE n.nspname='fiscal' AND a.grantee=0 AND a.privilege_type='EXECUTE'
  `);
  invariant(publicFunctionGrants[0]?.count==="0","PUBLIC can execute fiscal functions");

  const publicTableGrants=await queryRows<{count:string}>(db,`
    SELECT count(*)::text count
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) a
    WHERE n.nspname='fiscal' AND c.relkind='r' AND a.grantee=0
  `);
  invariant(publicTableGrants[0]?.count==="0","PUBLIC has fiscal table grants");

  const fiscalActual=await queryRows<{schema_name:string;table_name:string;column_name:string;grantee:string;privilege_type:string}>(db,`
    SELECT table_schema schema_name,table_name,column_name,grantee,privilege_type
    FROM information_schema.column_privileges
    WHERE table_schema='fiscal' AND grantee IN (${sqlList(RUNTIME_ROLES)})
      AND privilege_type IN ('SELECT','INSERT','UPDATE')
    ORDER BY 1,2,3,4,5
  `);
  const fiscalActualKeys=fiscalActual.map(row=>`${row.schema_name}|${row.table_name}|${row.column_name}|${row.grantee}|${row.privilege_type}`).sort();
  const fiscalExpected=expectedGrantKeys(POSTGRES_003_DESCRIPTOR.grantMatrix as unknown as GrantMatrix);
  invariant(same(fiscalActualKeys,fiscalExpected),"003 fiscal column grant matrix diverges");

  const extensionColumnSet=new Set(Object.entries(POSTGRES_003_DESCRIPTOR.integrationExtensionColumns)
    .flatMap(([table,columns])=>columns.map(column=>`${table}|${column}`)));
  const integrationActual=await queryRows<{schema_name:string;table_name:string;column_name:string;grantee:string;privilege_type:string}>(db,`
    SELECT table_schema schema_name,table_name,column_name,grantee,privilege_type
    FROM information_schema.column_privileges
    WHERE table_schema='integrations' AND grantee IN (${sqlList(RUNTIME_ROLES)})
      AND privilege_type IN ('SELECT','INSERT','UPDATE')
    ORDER BY 1,2,3,4,5
  `);
  const integrationActualKeys=integrationActual
    .filter(row=>extensionColumnSet.has(`${row.schema_name}.${row.table_name}|${row.column_name}`))
    .map(row=>`${row.schema_name}|${row.table_name}|${row.column_name}|${row.grantee}|${row.privilege_type}`).sort();
  const integrationExpected=expectedGrantKeys(POSTGRES_003_DESCRIPTOR.integrationExtensionGrants as unknown as GrantMatrix);
  invariant(same(integrationActualKeys,integrationExpected),"003 integration extension grant matrix diverges");
}
