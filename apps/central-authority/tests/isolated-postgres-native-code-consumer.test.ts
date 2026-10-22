import { describe, expect, it, vi } from "vitest";
import type { Pool } from "@pos-platform/database-postgres";
import { createHash } from "node:crypto";
import { IsolatedPostgresNativeCodeConsumer } from "../src/isolated-postgres-native-code-consumer.js";

const code="c".repeat(48);
const hash=createHash("sha256").update(code).digest("hex");
function setup(valid=true, verifierAccepted=true) {
  const calls: Array<[string, unknown[] | undefined]> = [];
  let consumed=false;
  let committed=false;
  const client={
    query:vi.fn(async (sql:string, values?:unknown[])=>{
      calls.push([sql,values]);
      if(sql==="BEGIN" || sql==="COMMIT" || sql==="ROLLBACK") { if(sql==="COMMIT") committed=true; return {rows:[]}; }
      if(sql.includes("current_database()")) return {rows:[{approved:true}]};
      if(sql.includes("FOR UPDATE")) return {rows:[valid&&!consumed?{
        client_id:"desktop",redirect_uri:"http://127.0.0.1:42133/callback",
        code_challenge:"x".repeat(43),state:"s".repeat(43),
        trusted_binding_id:"internal-only",valid:true,
      }: {valid:false}]};
      if(sql.includes("SET consumed_at")) {consumed=true;return {rows:[]};}
      throw new Error("UNEXPECTED_QUERY");
    }),release:vi.fn(),
  };
  const pool={options:{connectionString:"postgres://postgres@127.0.0.1:55433/pos_target_test"},connect:vi.fn(async()=>client)} as unknown as Pool;
  const resolver=vi.fn(async(id:string)=>{expect(committed).toBe(true);return {id};});
  const consumer=new IsolatedPostgresNativeCodeConsumer(pool,resolver);
  return {consumer,client,calls,resolver,get consumed(){return consumed;},verifierAccepted};
}
describe("isolated PostgreSQL code consumer — transactional contract",()=>{
  it("rejects external PostgreSQL without starting a transaction",()=>{
    const pool={options:{connectionString:"postgres://db.example.com:5432/production"}} as Pool;
    expect(()=>new IsolatedPostgresNativeCodeConsumer(pool,async()=>null)).toThrow("NATIVE_CODE_ISOLATED_POSTGRES_REQUIRED");
  });
  it("locks, burns and commits before resolving trusted in-process binding",async()=>{
    const f=setup();
    expect(await f.consumer.consume(code,()=>true)).toEqual({id:"internal-only"});
    expect(f.consumed).toBe(true);
    expect(f.resolver).toHaveBeenCalledOnce();
    expect(f.calls.map(([s])=>s==="BEGIN"?"BEGIN":s==="COMMIT"?"COMMIT":s.includes("FOR UPDATE")?"LOCK":s.includes("SET consumed_at")?"BURN":"CHECK"))
      .toEqual(["BEGIN","CHECK","LOCK","BURN","COMMIT"]);
    expect(f.calls.find(([s])=>s.includes("FOR UPDATE"))?.[1]).toEqual([hash]);
    expect(await f.consumer.consume(code,()=>true)).toBeNull();
    expect(f.resolver).toHaveBeenCalledOnce();
  });
  it("burns live codes even when client, state or PKCE verification fails",async()=>{
    const f=setup();
    expect(await f.consumer.consume(code,()=>false)).toBeNull();
    expect(f.consumed).toBe(true);
    expect(f.resolver).not.toHaveBeenCalled();
  });
  it("refuses malformed input without hitting PostgreSQL",async()=>{
    const f=setup();
    expect(await f.consumer.consume("bad",()=>true)).toBeNull();
    expect(f.client.query).not.toHaveBeenCalled();
  });
  it("rolls back and releases connection when verification raises an error",async()=>{
    const f=setup();
    await expect(f.consumer.consume(code,()=>{throw new Error("INVALID_INTERNAL_POLICY")})).rejects.toThrow("INVALID_INTERNAL_POLICY");
    expect(f.calls.some(([s])=>s==="ROLLBACK")).toBe(true);
    expect(f.calls.some(([s])=>s==="COMMIT")).toBe(false);
    expect(f.client.release).toHaveBeenCalledOnce();
  });
  it("rejects a non-isolated database before querying a grant",async()=>{
    const f=setup();
    f.client.query.mockImplementationOnce(async(sql:string)=>{expect(sql).toBe("BEGIN");return {rows:[]};});
    f.client.query.mockImplementationOnce(async()=>({rows:[{approved:false}]}));
    await expect(f.consumer.consume(code,()=>true)).rejects.toThrow("NATIVE_CODE_ISOLATED_DATABASE_REQUIRED");
    expect(f.calls.some(([s])=>s.includes("FOR UPDATE"))).toBe(false);
  });
});
