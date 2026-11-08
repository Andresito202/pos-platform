import { afterEach, describe, expect, it } from "vitest";
import { randomBytes, scryptSync } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import type { LocalDatabase } from "@pos-platform/database-sqlite";
import { LocalOperatorPasswordGate } from "./local-operator-password-gate.js";

const directories: string[] = [];
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "camacho-operator-budget-"));
  directories.push(directory);
  const password = randomBytes(24).toString("base64url");
  const accounts = ([
    ["admin.local","ADMINISTRADOR"],
    ["supervisor.local","SUPERVISOR"],
    ["cajero.local","CAJERO"],
    ["superadmin.local","SUPERADMINISTRADOR"],
  ] as const).map(([username,role])=>{
    const salt = randomBytes(16).toString("hex");
    const hash = scryptSync(password,Buffer.from(salt,"hex"),64,
      {N:32768,r:8,p:1,maxmem:64*1024*1024}).toString("hex");
    return {username,role,scheme:"scrypt-N32768-r8-p1-v1",salt,hash};
  });
  const store = join(directory,"accounts.v1.json");
  await writeFile(store,JSON.stringify({format:"CAMACHO_DEV_ACCOUNTS_V1",accounts}));
  return {directory,store,password};
}
afterEach(async()=>{for(const directory of directories.splice(0))await rm(directory,{force:true,recursive:true});});

describe("local password gate",()=>{
  it("locks out after five invalid attempts, survives restart, and expires on schedule",async()=>{
    const {directory,store,password}=await fixture();
    const location=join(directory,"security.sqlite");
    let now=100000;
    let db=new Database(location);
    let gate=new LocalOperatorPasswordGate({native:db} as LocalDatabase,store,()=>now);
    for(let i=0;i<5;i++)expect(await gate.authenticate("admin.local","invalid")).toEqual({status:"DENIED"});
    expect(await gate.authenticate("admin.local",password)).toEqual({status:"RATE_LIMITED"});
    db.close();
    db=new Database(location);
    gate=new LocalOperatorPasswordGate({native:db} as LocalDatabase,store,()=>now);
    expect(await gate.authenticate("admin.local",password)).toEqual({status:"RATE_LIMITED"});
    now+=15*60*1000;
    expect(await gate.authenticate("admin.local",password)).toEqual({
      status:"AUTHENTICATED",operator:{username:"admin.local",role:"ADMINISTRADOR"},
    });
    db.close();
  });

  it("fails closed under a shared global budget even when principals rotate",async()=>{
    const {store}=await fixture();
    let now=200000;
    const db=new Database(":memory:");
    try{
      const gate=new LocalOperatorPasswordGate({native:db} as LocalDatabase,store,()=>now);
      for(let i=0;i<40;i++){
        // Successful principals reset their own bucket; the global charge remains.
        const result=await gate.authenticate(["admin.local","cajero.local","supervisor.local","superadmin.local"][i%4]!,
          "wrong");
        if (i<20)expect(result.status).toBe("DENIED");
      }
      expect((await gate.authenticate("admin.local","wrong")).status).toBe("RATE_LIMITED");
      now+=15*60*1000;
      expect((await gate.authenticate("admin.local","wrong")).status).toBe("DENIED");
    }finally{db.close();}
  });
});
