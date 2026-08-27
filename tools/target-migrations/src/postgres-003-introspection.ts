import type { SqlExecutor } from "./database.js";
import { queryRows } from "./database.js";
import {
  FISCAL_TABLES,
  INTEGRATION_TABLES,
  POSTGRES_003_DESCRIPTOR,
  POSTGRES_TABLE_COLUMNS,
  TARGET_SCHEMAS,
} from "./contract.js";
import { MigrationInvariantError, sha256 } from "./shared.js";

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
      SELECT a.attname name
      FROM pg_attribute a
      JOIN pg_class c ON c.oid=a.attrelid
      JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE a.attnum>0 AND NOT a.attisdropped AND c.relkind='r'
        AND n.nspname='${schemaName}' AND c.relname='${tableName}'
      ORDER BY a.attnum
    `);
    const actualColumns=columns.map(row=>row.name);
    invariant(same(actualColumns,[...expected]),`003 predecessor 001 columns diverge for ${qualified}: actual=${JSON.stringify(actualColumns)} expected=${JSON.stringify(expected)}`);
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

async function semanticCatalogFingerprint(db:SqlExecutor):Promise<string>{
  const constraints=await queryRows<Record<string,unknown>>(db,`
    SELECT n.nspname schema_name,c.relname table_name,co.conname name,co.contype,co.condeferrable,co.condeferred,co.convalidated,pg_get_constraintdef(co.oid,false) definition
    FROM pg_constraint co JOIN pg_class c ON c.oid=co.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE co.conname IN (${sqlList(POSTGRES_003_DESCRIPTOR.ownedConstraints as readonly string[])}) ORDER BY 1,2,3
  `);
  const indexes=await queryRows<Record<string,unknown>>(db,`
    SELECT n.nspname schema_name,c.relname name,pg_get_indexdef(c.oid) definition
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE c.relkind='i' AND c.relname IN (${sqlList(POSTGRES_003_DESCRIPTOR.ownedIndexes as readonly string[])}) ORDER BY 1,2
  `);
  const triggers=await queryRows<Record<string,unknown>>(db,`
    SELECT n.nspname schema_name,c.relname table_name,t.tgname name,t.tgdeferrable,t.tginitdeferred,pg_get_triggerdef(t.oid,false) definition
    FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE NOT t.tgisinternal AND t.tgname IN (${sqlList(POSTGRES_003_DESCRIPTOR.expectedGuards as readonly string[])}) ORDER BY 1,2,3
  `);
  const policies=await queryRows<Record<string,unknown>>(db,`
    SELECT schemaname schema_name,tablename table_name,policyname name,permissive,roles,cmd,qual,with_check
    FROM pg_policies WHERE schemaname='fiscal' ORDER BY 1,2,3
  `);
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
  const unexpectedFiscalPrivileges=await queryRows<{table_name:string;grantee:string;privilege_type:string}>(db,`
    SELECT DISTINCT c.relname table_name,r.rolname grantee,a.privilege_type
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) a
    JOIN pg_roles r ON r.oid=a.grantee
    WHERE n.nspname='fiscal' AND c.relkind='r'
      AND r.rolname IN (${sqlList(RUNTIME_ROLES)})
      AND a.privilege_type NOT IN ('SELECT','INSERT','UPDATE')
    UNION
    SELECT DISTINCT c.relname,r.rolname,a.privilege_type
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    JOIN pg_attribute att ON att.attrelid=c.oid AND att.attnum>0 AND NOT att.attisdropped
    CROSS JOIN LATERAL aclexplode(att.attacl) a
    JOIN pg_roles r ON r.oid=a.grantee
    WHERE n.nspname='fiscal' AND c.relkind='r'
      AND r.rolname IN (${sqlList(RUNTIME_ROLES)})
      AND a.privilege_type NOT IN ('SELECT','INSERT','UPDATE')
  `);
  invariant(unexpectedFiscalPrivileges.length===0,`003 unexpected fiscal runtime privileges: ${JSON.stringify(unexpectedFiscalPrivileges)}`);

  const fiscalActual=await queryRows<{schema_name:string;table_name:string;column_name:string;grantee:string;privilege_type:string}>(db,`
    SELECT DISTINCT n.nspname schema_name,c.relname table_name,att.attname column_name,r.rolname grantee,a.privilege_type
    FROM pg_class c
    JOIN pg_namespace n ON n.oid=c.relnamespace
    JOIN pg_attribute att ON att.attrelid=c.oid AND att.attnum>0 AND NOT att.attisdropped
    CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) a
    JOIN pg_roles r ON r.oid=a.grantee
    WHERE n.nspname='fiscal' AND c.relkind='r' AND r.rolname IN (${sqlList(RUNTIME_ROLES)})
      AND a.privilege_type IN ('SELECT','INSERT','UPDATE')
    UNION
    SELECT n.nspname,c.relname,att.attname,r.rolname,a.privilege_type
    FROM pg_class c
    JOIN pg_namespace n ON n.oid=c.relnamespace
    JOIN pg_attribute att ON att.attrelid=c.oid AND att.attnum>0 AND NOT att.attisdropped
    CROSS JOIN LATERAL aclexplode(att.attacl) a
    JOIN pg_roles r ON r.oid=a.grantee
    WHERE n.nspname='fiscal' AND c.relkind='r' AND r.rolname IN (${sqlList(RUNTIME_ROLES)})
      AND a.privilege_type IN ('SELECT','INSERT','UPDATE')
    ORDER BY 1,2,3,4,5
  `);
  const fiscalActualKeys=fiscalActual.map(row=>`${row.schema_name}|${row.table_name}|${row.column_name}|${row.grantee}|${row.privilege_type}`).sort();
  const fiscalExpected=expectedGrantKeys(POSTGRES_003_DESCRIPTOR.grantMatrix as unknown as GrantMatrix);
  invariant(same(fiscalActualKeys,fiscalExpected),`003 fiscal column grant matrix diverges: actual=${JSON.stringify(fiscalActualKeys)} expected=${JSON.stringify(fiscalExpected)}`);

  const extensionColumnSet=new Set(Object.entries(POSTGRES_003_DESCRIPTOR.integrationExtensionColumns)
    .flatMap(([table,columns])=>columns.map(column=>`${table}|${column}`)));
  const integrationActual=await queryRows<{schema_name:string;table_name:string;column_name:string;grantee:string;privilege_type:string}>(db,`
    SELECT DISTINCT n.nspname schema_name,c.relname table_name,att.attname column_name,r.rolname grantee,a.privilege_type
    FROM pg_class c
    JOIN pg_namespace n ON n.oid=c.relnamespace
    JOIN pg_attribute att ON att.attrelid=c.oid AND att.attnum>0 AND NOT att.attisdropped
    CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) a
    JOIN pg_roles r ON r.oid=a.grantee
    WHERE n.nspname='integrations' AND c.relkind='r' AND r.rolname IN (${sqlList(RUNTIME_ROLES)})
      AND a.privilege_type IN ('SELECT','INSERT','UPDATE')
    UNION
    SELECT n.nspname,c.relname,att.attname,r.rolname,a.privilege_type
    FROM pg_class c
    JOIN pg_namespace n ON n.oid=c.relnamespace
    JOIN pg_attribute att ON att.attrelid=c.oid AND att.attnum>0 AND NOT att.attisdropped
    CROSS JOIN LATERAL aclexplode(att.attacl) a
    JOIN pg_roles r ON r.oid=a.grantee
    WHERE n.nspname='integrations' AND c.relkind='r' AND r.rolname IN (${sqlList(RUNTIME_ROLES)})
      AND a.privilege_type IN ('SELECT','INSERT','UPDATE')
    ORDER BY 1,2,3,4,5
  `);
  const integrationActualKeys=integrationActual
    .filter(row=>extensionColumnSet.has(`${row.schema_name}.${row.table_name}|${row.column_name}`))
    .map(row=>`${row.schema_name}|${row.table_name}|${row.column_name}|${row.grantee}|${row.privilege_type}`).sort();
  const integrationExpected=expectedGrantKeys(POSTGRES_003_DESCRIPTOR.integrationExtensionGrants as unknown as GrantMatrix);
  invariant(same(integrationActualKeys,integrationExpected),`003 integration extension grant matrix diverges: actual=${JSON.stringify(integrationActualKeys)} expected=${JSON.stringify(integrationExpected)}`);
}
