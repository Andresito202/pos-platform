import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from "node:crypto";
import { chmodSync, lstatSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

interface EncryptedSecret { readonly version: 1; readonly iv: string; readonly tag: string; readonly ciphertext: string; }

export class EncryptedFileSecretStore {
  constructor(private readonly directory: string, private readonly key: Buffer, private readonly context: string) {
    if (key.byteLength !== 32) throw new Error("secret store key must be exactly 256 bits");
    if (!context) throw new Error("secret store context is required");
  }
  private path(name: string): string {
    if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(name)) throw new Error("invalid secret name");
    return join(this.directory, `${name}.secret`);
  }
  write(name: string, plaintext: Buffer): void {
    const iv=randomBytes(12); const cipher=createCipheriv("aes-256-gcm",this.key,iv);
    cipher.setAAD(Buffer.from(this.context)); const ciphertext=Buffer.concat([cipher.update(plaintext),cipher.final()]);
    const value:EncryptedSecret={version:1,iv:iv.toString("base64url"),tag:cipher.getAuthTag().toString("base64url"),ciphertext:ciphertext.toString("base64url")};
    const target=this.path(name); const temporary=`${target}.tmp.${randomUUID()}`;
    writeFileSync(temporary,JSON.stringify(value),{encoding:"utf8",mode:0o600,flag:"wx"});
    chmodSync(temporary,0o600);
    try { renameSync(temporary,target); } catch(error) { try{unlinkSync(temporary);}catch{} throw error; }
  }
  read(name:string):Buffer {
    const target=this.path(name);
    if(lstatSync(target).isSymbolicLink()) throw new Error("secret file cannot be a symbolic link");
    const value=JSON.parse(readFileSync(target,"utf8")) as EncryptedSecret;
    if(value.version!==1) throw new Error("unsupported secret envelope version");
    const decipher=createDecipheriv("aes-256-gcm",this.key,Buffer.from(value.iv,"base64url"));
    decipher.setAAD(Buffer.from(this.context)); decipher.setAuthTag(Buffer.from(value.tag,"base64url"));
    try{return Buffer.concat([decipher.update(Buffer.from(value.ciphertext,"base64url")),decipher.final()]);}
    catch{throw new Error("secret envelope authentication failed");}
  }
}
