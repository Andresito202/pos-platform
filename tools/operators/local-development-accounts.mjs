#!/usr/bin/env node
// Development-only account provisioning/verifier. This file deliberately
// neither grants a commercial session nor alters the service's trust roots.
import {randomBytes,scrypt as scryptCallback,timingSafeEqual} from "node:crypto";
import {readFile,writeFile,mkdir,rename,open,stat} from "node:fs/promises";
import {homedir} from "node:os";
import {join,resolve} from "node:path";
import {promisify} from "node:util";
import {createInterface} from "node:readline";

const scrypt=promisify(scryptCallback);
const users=Object.freeze([
  ["admin.local","ADMINISTRADOR"],
  ["supervisor.local","SUPERVISOR"],
  ["cajero.local","CAJERO"],
  ["superadmin.local","SUPERADMINISTRADOR"],
]);
const userMap=new Map(users);
const base=process.platform==="win32"
  ?process.env.LOCALAPPDATA
  :process.env.XDG_STATE_HOME??join(homedir(),".local","state");
if(!base||!resolve(base).startsWith(resolve(homedir())))throw Error("LOCAL_DEVELOPMENT_USER_STORE_REQUIRED");
const directory=join(base,"CamachoPOS","development");
const filename=join(directory,"accounts.v1.json");
const args=process.argv.slice(2);
const action=args[0];
const keyLength=64;
const scryptOptions={N:32768,r:8,p:1,maxmem:64*1024*1024};
const marker="CAMACHO_DEV_ACCOUNTS_V1";
function reject(code){process.stderr.write(code+"\n");process.exitCode=1;}
function validate(data){
  if(data?.format!==marker||!Array.isArray(data.accounts)||data.accounts.length!==users.length)throw Error("DEV_ACCOUNT_STORE_INVALID");
  for (const [username,role] of users) {
    const a=data.accounts.find(x=>x?.username===username);
    if(!a||a.role!==role||a.scheme!=="scrypt-N32768-r8-p1-v1"||
      typeof a.salt!=="string"||!/^[a-f0-9]{32}$/.test(a.salt)||
      typeof a.hash!=="string"||!/^[a-f0-9]{128}$/.test(a.hash))throw Error("DEV_ACCOUNT_STORE_INVALID");
  }
  return data;
}
async function passwordHash(password,salt){
  return await scrypt(password,Buffer.from(salt,"hex"),keyLength,scryptOptions);
}
async function initialize(){
  if(args.length!==1)throw Error("DEV_INIT_NO_ARGUMENTS_ALLOWED");
  await mkdir(directory,{recursive:true,mode:0o700});
  try{await stat(filename);return reject("DEV_ACCOUNT_STORE_EXISTS_NO_OVERWRITE");}
  catch(e){if(e?.code!=="ENOENT")throw e;}
  const credentials=[];
  const accounts=[];
  for(const [username,role] of users){
    const password=randomBytes(24).toString("base64url");
    const salt=randomBytes(16).toString("hex");
    const hash=(await passwordHash(password,salt)).toString("hex");
    accounts.push({username,role,scheme:"scrypt-N32768-r8-p1-v1",salt,hash});
    credentials.push({username,role,password});
  }
  const record=validate({format:marker,accounts});
  // Exclusive creation, mode=0600 on POSIX; Windows directory inherits user's
  // profile ACLs. Never place this file inside the Git working tree.
  const file=await open(filename,"wx",0o600);
  try{await file.writeFile(JSON.stringify(record)+"\n","utf8");await file.sync();}
  finally{await file.close();}
  process.stdout.write("DEV_LOCAL_ACCOUNT_STORE_CREATED\n");
  process.stdout.write("PASSWORDS_SHOWN_ONCE_KEEP_PRIVATE\n");
  for(const c of credentials)process.stdout.write(c.username+" | "+c.role+" | "+c.password+"\n");
  process.stdout.write("These are DEV accounts only; no BUSINESS session issued.\n");
}
async function verify(){
  if(args.length!==2||!userMap.has(args[1]))return reject("DEV_USERNAME_REJECTED");
  const username=args[1];
  let data;
  try{data=validate(JSON.parse(await readFile(filename,"utf8")));}
  catch{return reject("DEV_ACCOUNT_STORE_MISSING_OR_INVALID");}
  // Password is delivered by standard input. Never pass it as an argv or
  // environment variable that other processes might observe.
  let password="";
  const rl=createInterface({input:process.stdin,terminal:false,crlfDelay:Infinity});
  for await (const line of rl){password+=line;break;}
  rl.close();
  if(password.length<1||password.length>512)return reject("DEV_AUTH_DENIED");
  const account=data.accounts.find(a=>a.username===username);
  const actual=await passwordHash(password,account.salt);
  const expected=Buffer.from(account.hash,"hex");
  if(!timingSafeEqual(actual,expected))return reject("DEV_AUTH_DENIED");
  // Explicitly only a local verification result. A caller must not treat this
  // role string as a centrally signed authorization assertion.
  process.stdout.write("DEV_PASSWORD_VERIFIED:"+account.role+"\n");
}
if(action==="init")await initialize();
else if(action==="verify")await verify();
else reject("DEV_USAGE: init | verify <known-username>");
