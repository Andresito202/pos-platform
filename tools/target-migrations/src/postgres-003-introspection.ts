import type { SqlExecutor } from "./database.js";
import { queryRows } from "./database.js";
import {
  FISCAL_TABLES,
  INTEGRATION_RLS_TABLES,
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

interface SemanticCatalogFingerprint{sha:string;components:Record<string,string>}
async function semanticCatalogFingerprint(db:SqlExecutor):Promise<SemanticCatalogFingerprint>{
  const columns=await queryRows<Record<string,unknown>>(db,`
    SELECT n.nspname schema_name,c.relname table_name,
      CASE WHEN n.nspname='fiscal' THEN a.attnum ELSE NULL END physical_ordinal,
      a.attname name,format_type(a.atttypid,a.atttypmod) type_name,
      a.attnotnull,a.attidentity,a.attgenerated,
      CASE WHEN a.attcollation=0 THEN NULL ELSE coll.collname END collation_name,
      pg_get_expr(ad.adbin,ad.adrelid,false) default_definition
    FROM pg_attribute a
    JOIN pg_class c ON c.oid=a.attrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace
    LEFT JOIN pg_attrdef ad ON ad.adrelid=a.attrelid AND ad.adnum=a.attnum
    LEFT JOIN pg_collation coll ON coll.oid=a.attcollation
    WHERE a.attnum>0 AND NOT a.attisdropped AND c.relkind='r'
      AND (
        n.nspname='fiscal'
        OR (
          n.nspname='integrations' AND (
            (c.relname='integration_dispatches' AND a.attname IN ('fiscal_document_preparation_id','fiscal_preparation_generation','fiscal_request_semantic_version','fiscal_request_semantic_checksum'))
            OR (c.relname='external_webhook_receipts' AND a.attname IN ('fiscal_electronic_document_id','fiscal_document_preparation_id','fiscal_preparation_generation','fiscal_integration_dispatch_id','fiscal_correlated_at'))
          )
        )
      )
    ORDER BY 1,2,4
  `);
  const constraints=await queryRows<Record<string,unknown>>(db,`
    SELECT n.nspname schema_name,c.relname table_name,co.conname name,co.contype,co.condeferrable,co.condeferred,co.convalidated,pg_get_constraintdef(co.oid,false) definition
    FROM pg_constraint co JOIN pg_class c ON c.oid=co.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE co.conname IN (${sqlList(POSTGRES_003_DESCRIPTOR.ownedConstraints as readonly string[])}) ORDER BY 1,2,3
  `);
  const indexes=await queryRows<Record<string,unknown>>(db,`
    SELECT n.nspname schema_name,c.relname name,pg_get_indexdef(c.oid) definition,
      x.indisvalid,x.indisready,x.indislive
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    JOIN pg_index x ON x.indexrelid=c.oid
    WHERE c.relkind='i' AND c.relname IN (${sqlList(POSTGRES_003_DESCRIPTOR.ownedIndexes as readonly string[])}) ORDER BY 1,2
  `);
  const triggers=await queryRows<Record<string,unknown>>(db,`
    SELECT n.nspname schema_name,c.relname table_name,t.tgname name,t.tgenabled,t.tgdeferrable,t.tginitdeferred,pg_get_triggerdef(t.oid,false) definition
    FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE NOT t.tgisinternal AND t.tgname IN (${sqlList(POSTGRES_003_DESCRIPTOR.expectedGuards as readonly string[])}) ORDER BY 1,2,3
  `);
  const policies=await queryRows<Record<string,unknown>>(db,`
    SELECT schemaname schema_name,tablename table_name,policyname name,permissive,roles,cmd,qual,with_check
    FROM pg_policies WHERE schemaname='fiscal' ORDER BY 1,2,3
  `);
  const functions=await queryRows<Record<string,unknown>>(db,`
    SELECT n.nspname schema_name,p.proname name,pg_get_function_identity_arguments(p.oid) identity_arguments,
      pg_get_function_result(p.oid) result_type,l.lanname language,p.provolatile,p.proparallel,p.prosecdef,p.proconfig,p.prosrc body
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang
    WHERE n.nspname='fiscal' ORDER BY 1,2,3
  `);
  const integrationSemantics=await queryRows<Record<string,unknown>>(db,`
    SELECT 'constraint' kind,n.nspname schema_name,c.relname table_name,x.conname name,
      x.contype::text||':'||pg_get_constraintdef(x.oid,true) definition
    FROM pg_constraint x JOIN pg_class c ON c.oid=x.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='integrations'
    UNION ALL
    SELECT 'index',n.nspname,c.relname,i.relname,
      pg_get_indexdef(i.oid,0,true)||':'||x.indisvalid::text||':'||x.indisready::text||':'||x.indislive::text
    FROM pg_index x JOIN pg_class c ON c.oid=x.indrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    JOIN pg_class i ON i.oid=x.indexrelid WHERE n.nspname='integrations'
    UNION ALL
    SELECT 'trigger',n.nspname,c.relname,t.tgname,pg_get_triggerdef(t.oid,true)||':'||t.tgenabled::text
    FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='integrations' AND NOT t.tgisinternal
    UNION ALL
    SELECT 'policy',n.nspname,c.relname,p.polname,
      concat_ws(':',p.polcmd::text,p.polpermissive,
        (SELECT string_agg(pg_get_userbyid(role_oid),',' ORDER BY pg_get_userbyid(role_oid)) FROM unnest(p.polroles) role_oid),
        coalesce(pg_get_expr(p.polqual,p.polrelid,true),''),coalesce(pg_get_expr(p.polwithcheck,p.polrelid,true),''))
    FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='integrations'
    UNION ALL
    SELECT 'function',n.nspname,'',p.proname||'('||pg_get_function_identity_arguments(p.oid)||')',pg_get_functiondef(p.oid)
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='integrations'
    ORDER BY 1,2,3,4
  `);
  const source={columns,constraints,indexes,triggers,policies,functions,integrationSemantics};
  const components=Object.fromEntries(Object.entries(source).map(([name,value])=>[
    name,sha256(JSON.stringify(value)).toString('hex'),
  ]));
  const columnTables=Object.fromEntries(
    [...new Set(columns.map(row=>`${String(row.schema_name)}.${String(row.table_name)}`))].sort().map(table=>{
      const rows=columns.filter(row=>`${String(row.schema_name)}.${String(row.table_name)}`===table);
      return [`columns:${table}`,sha256(JSON.stringify(rows)).toString('hex')];
    }),
  );
  return {sha:sha256(JSON.stringify(source)).toString('hex'),components:{...components,...columnTables}};
}
export async function validatePostgres003Catalog(db:SqlExecutor):Promise<void>{
  await validate001FoundationShape(db);

  const extension=(await queryRows<{present:boolean}>(db,"SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname='btree_gist') present"))[0];
  invariant(extension?.present,"003 requires btree_gist");

  const schema=(await queryRows<{owner:string}>(db,"SELECT pg_get_userbyid(nspowner) owner FROM pg_namespace WHERE nspname='fiscal'"))[0];
  invariant(schema?.owner==="pos_schema_owner","003 fiscal schema owner diverges");
  const schemaGrants=await queryRows<{grantee:string;privilege_type:string;is_grantable:boolean}>(db,`
    SELECT CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END grantee,
      a.privilege_type,a.is_grantable
    FROM pg_namespace n
    CROSS JOIN LATERAL aclexplode(COALESCE(n.nspacl,acldefault('n',n.nspowner))) a
    WHERE n.nspname='fiscal' AND a.grantee<>n.nspowner
    ORDER BY 1,2,3
  `);
  const actualSchemaGrantKeys=schemaGrants.map(row=>`${row.grantee}|${row.privilege_type}|${row.is_grantable}`);
  const expectedSchemaGrantKeys=["pos_app|USAGE|false","pos_platform_admin|USAGE|false","pos_platform_app|USAGE|false","pos_worker|USAGE|false"];
  invariant(same(actualSchemaGrantKeys,expectedSchemaGrantKeys),
    `003 fiscal schema grant matrix diverges: actual=${JSON.stringify(actualSchemaGrantKeys)} expected=${JSON.stringify(expectedSchemaGrantKeys)}`);

  const tables=await queryRows<{name:string;owner:string;rls:boolean;forced:boolean}>(db,`
    SELECT c.relname name,pg_get_userbyid(c.relowner) owner,c.relrowsecurity rls,c.relforcerowsecurity forced
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='fiscal' AND c.relkind='r' ORDER BY c.relname
  `);
  invariant(same(tables.map(row=>row.name),[...FISCAL_TABLES].sort()),"003 fiscal table set diverges");
  invariant(tables.every(row=>row.owner==="pos_schema_owner"&&row.rls&&row.forced),"003 fiscal owner/RLS diverges");
  const semanticFingerprint=await semanticCatalogFingerprint(db);
  invariant(semanticFingerprint.sha===POSTGRES_003_DESCRIPTOR.semanticCatalogSha256,`003 semantic catalog fingerprint diverges: actual=${semanticFingerprint.sha} expected=${POSTGRES_003_DESCRIPTOR.semanticCatalogSha256} components=${JSON.stringify(semanticFingerprint.components)}`);

  for(const [qualified,expected] of Object.entries(POSTGRES_003_DESCRIPTOR.expectedTableColumns)){
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
    invariant(same(columns.map(row=>row.name),[...expected]),`003 columns diverge for ${qualified}`);
  }

  const integrationTables=await queryRows<{name:string;owner:string;rls:boolean;forced:boolean}>(db,`
    SELECT c.relname name,pg_get_userbyid(c.relowner) owner,c.relrowsecurity rls,c.relforcerowsecurity forced
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='integrations' AND c.relkind='r' ORDER BY c.relname
  `);
  invariant(same(integrationTables.map(row=>row.name),[...INTEGRATION_TABLES].sort()),"003 predecessor integration table set diverges");
  invariant(integrationTables.every(row=>row.owner==="pos_schema_owner"),"003 predecessor integration table owner diverges");
  invariant(integrationTables.every(row=>{
    const expected=INTEGRATION_RLS_TABLES.includes(row.name);
    return row.rls===expected&&row.forced===expected;
  }),"003 predecessor integration table RLS diverges");

  for(const [qualified,columns] of Object.entries(POSTGRES_003_DESCRIPTOR.integrationExtensionColumns)){
    const [schemaName,tableName]=qualified.split(".");
    const actual=await queryRows<{name:string}>(db,`
      SELECT a.attname name
      FROM pg_attribute a
      JOIN pg_class c ON c.oid=a.attrelid
      JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE a.attnum>0 AND NOT a.attisdropped AND c.relkind='r'
        AND n.nspname='${schemaName}' AND c.relname='${tableName}'
        AND a.attname IN (${sqlList(columns)})
      ORDER BY a.attname
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

  const expectedPolicyKeys=Object.entries(POSTGRES_003_DESCRIPTOR.exactPolicyDefinitions).map(([name,definition])=>{
    const match=definition.match(/^CREATE POLICY\s+[a-z][a-z0-9_]*\s+ON\s+([a-z][a-z0-9_.]*)/i);
    invariant(match,`003 cannot parse policy definition for ${name}`);
    return `${match[1]}|${name}`;
  }).sort();
  const policies=await queryRows<{key:string}>(db,`
    SELECT schemaname||'.'||tablename||'|'||policyname AS key
    FROM pg_policies WHERE schemaname='fiscal'
    ORDER BY 1
  `);
  const actualPolicyKeys=policies.map(row=>row.key);
  invariant(
    same(actualPolicyKeys,expectedPolicyKeys),
    `003 policy set diverges: actual=${JSON.stringify(actualPolicyKeys)} expected=${JSON.stringify(expectedPolicyKeys)}`,
  );

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
  const functionRuntimeGrants=await queryRows<{name:string;grantee:string;privilege_type:string;is_grantable:boolean}>(db,`
    SELECT p.proname name,r.rolname grantee,a.privilege_type,a.is_grantable
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a
    JOIN pg_roles r ON r.oid=a.grantee
    WHERE n.nspname='fiscal' AND r.rolname IN (${sqlList(RUNTIME_ROLES)})
    ORDER BY 1,2,3,4
  `);
  invariant(functionRuntimeGrants.every(row=>row.privilege_type==='EXECUTE'&&!row.is_grantable),
    `003 fiscal function runtime grants invalid: ${JSON.stringify(functionRuntimeGrants)}`);
  const actualFunctionGrantKeys=functionRuntimeGrants.map(row=>`${row.name}|${row.grantee}`).sort();
  const expectedFunctionGrantKeys=Object.entries(POSTGRES_003_DESCRIPTOR.functionExecuteGrants)
    .flatMap(([name,roles])=>roles.map(role=>`${name}|${role}`)).sort();
  invariant(same(actualFunctionGrantKeys,expectedFunctionGrantKeys),
    `003 fiscal function execute grant matrix diverges: actual=${JSON.stringify(actualFunctionGrantKeys)} expected=${JSON.stringify(expectedFunctionGrantKeys)}`);

  const publicTableGrants=await queryRows<{count:string}>(db,`
    SELECT count(*)::text count
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) a
    WHERE n.nspname='fiscal' AND c.relkind='r' AND a.grantee=0
  `);
  invariant(publicTableGrants[0]?.count==="0","PUBLIC has fiscal table grants");
  const publicColumnGrants=await queryRows<{count:string}>(db,`
    SELECT count(*)::text count
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    JOIN pg_attribute att ON att.attrelid=c.oid AND att.attnum>0 AND NOT att.attisdropped
    CROSS JOIN LATERAL aclexplode(att.attacl) a
    WHERE n.nspname='fiscal' AND c.relkind='r' AND a.grantee=0
  `);
  invariant(publicColumnGrants[0]?.count==="0","PUBLIC has fiscal column grants");
  const unlistedFiscalGrants=await queryRows<{object_name:string;column_name:string|null;grantee:string;privilege_type:string}>(db,`
    SELECT c.relname object_name,NULL::text column_name,r.rolname grantee,a.privilege_type
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) a
    JOIN pg_roles r ON r.oid=a.grantee
    WHERE n.nspname='fiscal' AND c.relkind='r' AND a.grantee<>c.relowner
      AND r.rolname NOT IN (${sqlList(RUNTIME_ROLES)})
    UNION ALL
    SELECT c.relname,att.attname,r.rolname,a.privilege_type
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    JOIN pg_attribute att ON att.attrelid=c.oid AND att.attnum>0 AND NOT att.attisdropped
    CROSS JOIN LATERAL aclexplode(att.attacl) a JOIN pg_roles r ON r.oid=a.grantee
    WHERE n.nspname='fiscal' AND c.relkind='r' AND a.grantee<>c.relowner
      AND r.rolname NOT IN (${sqlList(RUNTIME_ROLES)})
  `);
  invariant(unlistedFiscalGrants.length===0,`003 unlisted roles have fiscal grants: ${JSON.stringify(unlistedFiscalGrants)}`);
  const unlistedFunctionGrants=await queryRows<{name:string;grantee:string;privilege_type:string}>(db,`
    SELECT p.proname name,r.rolname grantee,a.privilege_type
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a
    JOIN pg_roles r ON r.oid=a.grantee
    WHERE n.nspname='fiscal' AND a.grantee<>p.proowner
      AND r.rolname NOT IN (${sqlList(RUNTIME_ROLES)})
  `);
  invariant(unlistedFunctionGrants.length===0,`003 unlisted roles have fiscal function grants: ${JSON.stringify(unlistedFunctionGrants)}`);
  const grantableFiscalPrivileges=await queryRows<{table_name:string;column_name:string|null;grantee:string;privilege_type:string}>(db,`
    SELECT DISTINCT c.relname table_name,NULL::text column_name,r.rolname grantee,a.privilege_type
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) a
    JOIN pg_roles r ON r.oid=a.grantee
    WHERE n.nspname='fiscal' AND c.relkind='r'
      AND r.rolname IN (${sqlList(RUNTIME_ROLES)}) AND a.is_grantable
    UNION
    SELECT DISTINCT c.relname,att.attname,r.rolname,a.privilege_type
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    JOIN pg_attribute att ON att.attrelid=c.oid AND att.attnum>0 AND NOT att.attisdropped
    CROSS JOIN LATERAL aclexplode(att.attacl) a
    JOIN pg_roles r ON r.oid=a.grantee
    WHERE n.nspname='fiscal' AND c.relkind='r'
      AND r.rolname IN (${sqlList(RUNTIME_ROLES)}) AND a.is_grantable
  `);
  invariant(grantableFiscalPrivileges.length===0,`003 fiscal runtime grants must not be grantable: ${JSON.stringify(grantableFiscalPrivileges)}`);
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
  const grantableIntegrationPrivileges=await queryRows<{table_name:string;column_name:string|null;grantee:string;privilege_type:string}>(db,`
    SELECT DISTINCT c.relname table_name,NULL::text column_name,r.rolname grantee,a.privilege_type
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) a
    JOIN pg_roles r ON r.oid=a.grantee
    WHERE n.nspname='integrations' AND c.relname IN ('integration_dispatches','external_webhook_receipts')
      AND r.rolname IN (${sqlList(RUNTIME_ROLES)}) AND a.is_grantable
    UNION
    SELECT DISTINCT c.relname,att.attname,r.rolname,a.privilege_type
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    JOIN pg_attribute att ON att.attrelid=c.oid AND att.attnum>0 AND NOT att.attisdropped
    CROSS JOIN LATERAL aclexplode(att.attacl) a
    JOIN pg_roles r ON r.oid=a.grantee
    WHERE n.nspname='integrations' AND c.relname IN ('integration_dispatches','external_webhook_receipts')
      AND r.rolname IN (${sqlList(RUNTIME_ROLES)}) AND a.is_grantable
      AND att.attname IN (${sqlList(Object.values(POSTGRES_003_DESCRIPTOR.integrationExtensionColumns).flat())})
  `);
  invariant(grantableIntegrationPrivileges.length===0,`003 integration extension runtime grants must not be grantable: ${JSON.stringify(grantableIntegrationPrivileges)}`);
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
