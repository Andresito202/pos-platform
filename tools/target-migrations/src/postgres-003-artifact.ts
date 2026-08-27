import { FISCAL_003_TABLE_BLUEPRINT_SQL, FISCAL_003_EXTRA_CONSTRAINT_SQL, FISCAL_003_INDEX_BLUEPRINT_SQL, FISCAL_003_TRIGGER_BLUEPRINT_SQL, FISCAL_003_POLICY_BLUEPRINT_SQL } from "./postgres-003-blueprint.js";
import { FISCAL_003_FUNCTION_DEFINITION_SQL } from "./postgres-003-functions.js";
import { FISCAL_003_CATALOG_DEFINITIONS } from "./postgres-003-catalog.js";
import { FISCAL_003_GRANT_MATRIX, FISCAL_003_INTEGRATION_EXTENSION_GRANTS } from "./contract.js";
import { FISCAL_003_DISPATCH_CLASS_TRANSITION, FISCAL_003_RECEIPT_UPDATE_GUARD_TRANSITION, FISCAL_003_LEGACY_GRANT_TRANSITIONS } from "./postgres-003-transitions.js";

type GrantEntry={select:readonly string[];insert:readonly string[];update:readonly string[]};
type GrantMatrix=Record<string,Record<string,GrantEntry>>;
type ColumnDefinition={type:string;nullable:boolean;defaultSql:string|null};
const RUNTIME_ROLES=["pos_app","pos_worker","pos_platform_app","pos_platform_admin"] as const;

function statement(value:string):string{
  const trimmed=value.trim();
  return trimmed.endsWith(";")?trimmed:`${trimmed};`;
}
function joinStatements(values:readonly string[]):string{
  return values.filter((value)=>value.trim().length>0).map(statement).join("\n\n")+"\n";
}
function functionIdentity(createSql:string):string{
  const match=createSql.match(/^CREATE FUNCTION\s+([a-z][a-z0-9_.]*)\(([^)]*)\)/i);
  if(!match) throw new Error("cannot parse SQL003 function identity");
  return `${match[1]}(${match[2]})`;
}
function constraintDrop(createSql:string):string{
  const match=createSql.match(/^ALTER TABLE\s+([a-z][a-z0-9_.]*)\s+ADD CONSTRAINT\s+([a-z][a-z0-9_]*)/i);
  if(!match) throw new Error("cannot parse SQL003 extra constraint");
  return `ALTER TABLE ${match[1]} DROP CONSTRAINT ${match[2]};`;
}
function triggerDrop(createSql:string):string{
  const match=createSql.match(/^CREATE (?:CONSTRAINT )?TRIGGER\s+([a-z][a-z0-9_]*)[\s\S]*?\sON\s+([a-z][a-z0-9_.]*)\s/i);
  if(!match) throw new Error("cannot parse SQL003 trigger");
  return `DROP TRIGGER ${match[1]} ON ${match[2]};`;
}
function policyDrop(createSql:string):string{
  const match=createSql.match(/^CREATE POLICY\s+([a-z][a-z0-9_]*)\s+ON\s+([a-z][a-z0-9_.]*)/i);
  if(!match) throw new Error("cannot parse SQL003 policy");
  return `DROP POLICY ${match[1]} ON ${match[2]};`;
}
function indexDrop(createSql:string):string{
  const match=createSql.match(/^CREATE (?:UNIQUE )?INDEX\s+([a-z][a-z0-9_]*)\s+ON\s+([a-z][a-z0-9_]*)\./i);
  if(!match) throw new Error("cannot parse SQL003 index");
  return `DROP INDEX ${match[2]}.${match[1]};`;
}
function grantStatements(matrix:GrantMatrix):string[]{
  const result:string[]=[];
  for(const [table,byRole] of Object.entries(matrix)){
    for(const role of RUNTIME_ROLES){
      const entry=byRole[role];
      if(!entry) continue;
      for(const [operation,key] of [["SELECT","select"],["INSERT","insert"],["UPDATE","update"]] as const){
        const columns=entry[key];
        if(columns.length>0) result.push(`GRANT ${operation} (${columns.join(",")}) ON ${table} TO ${role};`);
      }
    }
  }
  return result;
}
function extensionColumnStatements():{up:string[];down:string[]}{
  const keys=["integrations.integration_dispatches#003","integrations.external_webhook_receipts#003"] as const;
  const up:string[]=[];
  const down:string[]=[];
  for(const key of keys){
    const table=key.replace("#003","");
    const columns=FISCAL_003_CATALOG_DEFINITIONS.columns[key] as Record<string,ColumnDefinition>;
    for(const [name,definition] of Object.entries(columns)){
      up.push(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition.type} ${definition.nullable?"NULL":"NOT NULL"}${definition.defaultSql?` DEFAULT ${definition.defaultSql}`:""};`);
      down.unshift(`ALTER TABLE ${table} DROP COLUMN ${name};`);
    }
  }
  return {up,down};
}

export function buildPostgres003UpSql():string{
  const functions=Object.entries(FISCAL_003_FUNCTION_DEFINITION_SQL);
  const safeExternal=FISCAL_003_FUNCTION_DEFINITION_SQL.safe_external_text;
  if(!safeExternal) throw new Error("SQL003 safe_external_text definition missing");
  const remainingFunctions=functions.filter(([name])=>name!=="safe_external_text").map(([,sql])=>sql);
  const functionOwners=functions.map(([,sql])=>`ALTER FUNCTION ${functionIdentity(sql)} OWNER TO pos_schema_owner;`);
  const extension=extensionColumnStatements();
  const preConstraints=FISCAL_003_EXTRA_CONSTRAINT_SQL.filter((sql)=>/^ALTER TABLE integrations\.(integration_capabilities|integration_credential_bindings) ADD CONSTRAINT/.test(sql));
  const postConstraints=FISCAL_003_EXTRA_CONSTRAINT_SQL.filter((sql)=>!preConstraints.includes(sql));
  const tables=Object.keys(FISCAL_003_TABLE_BLUEPRINT_SQL);
  const rls=tables.flatMap((table)=>[`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;`,`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY;`]);
  const genericTriggers=FISCAL_003_TRIGGER_BLUEPRINT_SQL.filter((sql)=>!sql.includes(`TRIGGER ${FISCAL_003_RECEIPT_UPDATE_GUARD_TRANSITION.successorName} `));
  return joinStatements([
    "CREATE SCHEMA fiscal AUTHORIZATION pos_schema_owner;",
    "REVOKE ALL ON SCHEMA fiscal FROM PUBLIC;",
    safeExternal,
    ...extension.up,
    ...preConstraints,
    ...Object.values(FISCAL_003_TABLE_BLUEPRINT_SQL),
    ...postConstraints,
    ...remainingFunctions,
    ...FISCAL_003_INDEX_BLUEPRINT_SQL,
    ...rls,
    ...FISCAL_003_POLICY_BLUEPRINT_SQL,
    ...genericTriggers,
    ...FISCAL_003_RECEIPT_UPDATE_GUARD_TRANSITION.upSql,
    ...FISCAL_003_LEGACY_GRANT_TRANSITIONS.receiptIngress.upSql,
    ...FISCAL_003_LEGACY_GRANT_TRANSITIONS.dispatchIngress.upSql,
    ...FISCAL_003_LEGACY_GRANT_TRANSITIONS.lockRows.upSql,
    "GRANT USAGE ON SCHEMA fiscal TO pos_app,pos_worker,pos_platform_app,pos_platform_admin;",
    "REVOKE ALL ON ALL TABLES IN SCHEMA fiscal FROM PUBLIC;",
    "REVOKE ALL ON ALL FUNCTIONS IN SCHEMA fiscal FROM PUBLIC;",
    ...grantStatements(FISCAL_003_GRANT_MATRIX as unknown as GrantMatrix),
    ...grantStatements(FISCAL_003_INTEGRATION_EXTENSION_GRANTS as unknown as GrantMatrix),
    "GRANT EXECUTE ON FUNCTION fiscal.safe_external_text(text,integer) TO pos_app,pos_worker,pos_schema_owner;",
    "GRANT EXECUTE ON FUNCTION fiscal.has_correlated_generation_evidence(uuid,uuid,bigint) TO pos_app,pos_worker,pos_schema_owner;",
    ...functionOwners,
    ...FISCAL_003_DISPATCH_CLASS_TRANSITION.upSql,
  ]);
}

export function buildPostgres003DownSql():string{
  const functions=Object.entries(FISCAL_003_FUNCTION_DEFINITION_SQL);
  const extension=extensionColumnStatements();
  const preConstraints=FISCAL_003_EXTRA_CONSTRAINT_SQL.filter((sql)=>/^ALTER TABLE integrations\.(integration_capabilities|integration_credential_bindings) ADD CONSTRAINT/.test(sql));
  const postConstraints=FISCAL_003_EXTRA_CONSTRAINT_SQL.filter((sql)=>!preConstraints.includes(sql));
  const genericTriggers=FISCAL_003_TRIGGER_BLUEPRINT_SQL.filter((sql)=>!sql.includes(`TRIGGER ${FISCAL_003_RECEIPT_UPDATE_GUARD_TRANSITION.successorName} `));
  return joinStatements([
    ...FISCAL_003_DISPATCH_CLASS_TRANSITION.downSql,
    ...FISCAL_003_RECEIPT_UPDATE_GUARD_TRANSITION.downSql,
    ...[...genericTriggers].reverse().map(triggerDrop),
    ...[...FISCAL_003_POLICY_BLUEPRINT_SQL].reverse().map(policyDrop),
    ...[...FISCAL_003_INDEX_BLUEPRINT_SQL].reverse().map(indexDrop),
    ...[...postConstraints].reverse().map(constraintDrop),
    "REVOKE ALL ON ALL TABLES IN SCHEMA fiscal FROM pos_app,pos_worker,pos_platform_app,pos_platform_admin,pos_reporting;",
    "REVOKE USAGE ON SCHEMA fiscal FROM pos_app,pos_worker,pos_platform_app,pos_platform_admin,pos_reporting;",
    ...FISCAL_003_LEGACY_GRANT_TRANSITIONS.lockRows.downSql,
    ...FISCAL_003_LEGACY_GRANT_TRANSITIONS.dispatchIngress.downSql,
    ...FISCAL_003_LEGACY_GRANT_TRANSITIONS.receiptIngress.downSql,
    ...Object.keys(FISCAL_003_TABLE_BLUEPRINT_SQL).reverse().map((table)=>`DROP TABLE ${table};`),
    ...[...preConstraints].reverse().map(constraintDrop),
    ...extension.down,
    ...[...functions].reverse().map(([,sql])=>`DROP FUNCTION ${functionIdentity(sql)};`),
    "DROP SCHEMA fiscal;",
  ]);
}
