import {test} from "node:test";
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {mkdtempSync,readFileSync,rmSync} from "node:fs";
import {homedir} from "node:os";
import {join,resolve} from "node:path";
import {fileURLToPath} from "node:url";

const script=fileURLToPath(new URL("./local-development-accounts.mjs",import.meta.url));
test("local role account creation, scrypt verifier, no overwrite and negative password checks",()=>{
  const directory=mkdtempSync(join(homedir(),".camacho-dev-user-fixture-"));
  const env={...process.env,LOCALAPPDATA:directory,XDG_STATE_HOME:directory};
  const run=(args,input)=>spawnSync(process.execPath,[script,...args],{encoding:"utf8",env,...(input===undefined?{}:{input})});
  try{
    const initialized=run(["init"]);
    assert.equal(initialized.status,0,initialized.stderr);
    const lines=initialized.stdout.trim().split("\n");
    assert.match(initialized.stdout,/PASSWORDS_SHOWN_ONCE_KEEP_PRIVATE/);
    const pairs=lines.filter(s=>s.includes(" | ")).map(s=>s.split(" | "));
    assert.equal(pairs.length,4);
    const db=readFileSync(join(directory,"CamachoPOS","development","accounts.v1.json"),"utf8");
    assert.ok(db.includes("scrypt-N32768-r8-p1-v1"));
    for(const [username,role,password] of pairs){
      assert.ok(!db.includes(password),"Passwords must never be saved in plain text");
      const valid=run(["verify",username],password+"\n");
      assert.equal(valid.status,0,valid.stderr);
      assert.equal(valid.stdout.trim(),"DEV_PASSWORD_VERIFIED:"+role);
      const bad=run(["verify",username],"wrong password\n");
      assert.notEqual(bad.status,0);
      assert.match(bad.stderr,/DEV_AUTH_DENIED/);
    }
    const duplicate=run(["init"]);
    assert.notEqual(duplicate.status,0);
    assert.match(duplicate.stderr,/DEV_ACCOUNT_STORE_EXISTS_NO_OVERWRITE/);
    const foreign=run(["verify","root"],"anything\n");
    assert.notEqual(foreign.status,0);
  }finally{
    assert.ok(resolve(directory).startsWith(resolve(homedir())+ (process.platform==="win32"?"\\":"/")));
    rmSync(directory,{recursive:true,force:true});
  }
});
