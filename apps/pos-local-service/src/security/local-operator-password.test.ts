import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes, scryptSync } from "node:crypto";
import { verifyLocalOperatorPassword } from "./local-operator-password.js";

const accounts = [
  ["admin.local", "ADMINISTRADOR"],
  ["supervisor.local", "SUPERVISOR"],
  ["cajero.local", "CAJERO"],
  ["superadmin.local", "SUPERADMINISTRADOR"],
] as const;
const directories: string[] = [];

async function fixture(): Promise<{file:string; password:string; directory:string}> {
  const directory = await mkdtemp(join(tmpdir(), "camacho-real-local-auth-"));
  directories.push(directory);
  const password = randomBytes(24).toString("base64url");
  const records = accounts.map(([username, role]) => {
    const salt = randomBytes(16).toString("hex");
    const hash = scryptSync(password, Buffer.from(salt, "hex"), 64,
      {N:32768,r:8,p:1,maxmem:64*1024*1024}).toString("hex");
    return {username,role,scheme:"scrypt-N32768-r8-p1-v1",salt,hash};
  });
  const file=join(directory,"accounts.v1.json");
  await writeFile(file, JSON.stringify({format:"CAMACHO_DEV_ACCOUNTS_V1",accounts:records}));
  return {file,password,directory};
}
afterEach(async()=>{for(const dir of directories.splice(0))await rm(dir,{recursive:true,force:true});});

describe("local operator password verification",()=>{
  it("authenticates only the exact account and server-stored role",async()=>{
    const {file,password}=await fixture();
    for(const [username,role] of accounts){
      expect(await verifyLocalOperatorPassword(file,username,password)).toEqual({username,role});
    }
    expect(await verifyLocalOperatorPassword(file,"admin.local",password+"x")).toBeNull();
    expect(await verifyLocalOperatorPassword(file,"root.local",password)).toBeNull();
    expect(await verifyLocalOperatorPassword(file,"admin.local","")).toBeNull();
  });

  it("rejects modified role mappings, duplicates and invalid hashes",async()=>{
    const {file,password}=await fixture();
    const data=JSON.parse(await (await import("node:fs/promises")).readFile(file,"utf8"));
    data.accounts[0].role="SUPERADMINISTRADOR";
    await writeFile(file,JSON.stringify(data));
    await expect(verifyLocalOperatorPassword(file,"admin.local",password))
      .rejects.toThrow("LOCAL_OPERATOR_STORE_INVALID");
    data.accounts[0].role="ADMINISTRADOR";
    data.accounts[1]=data.accounts[0];
    await writeFile(file,JSON.stringify(data));
    await expect(verifyLocalOperatorPassword(file,"admin.local",password))
      .rejects.toThrow("LOCAL_OPERATOR_STORE_INVALID");
  });

  it("rejects a symlink account store",async()=>{
    const {file,directory,password}=await fixture();
    const link=join(directory,"linked.json");
    await symlink(file,link);
    await expect(verifyLocalOperatorPassword(link,"admin.local",password))
      .rejects.toThrow("LOCAL_OPERATOR_STORE_INVALID");
  });
});
