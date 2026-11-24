import { mkdtempSync,realpathSync,rmSync } from "node:fs";
import { basename,dirname,join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import { describe,expect,it } from "vitest";
import { AndroidKeystoreKeyProvider } from "../src/security/android-keystore-key-provider.js";
import { EncryptedFileSecretStore } from "../src/security/encrypted-secret-store.js";

describe("privileged Android custody adapter",()=>{
  it("rejects another OS, invalid roots, empty/oversized contexts and use after destruction",()=>{
    expect(()=>new AndroidKeystoreKeyProvider(Buffer.alloc(32),"win32")).toThrow("ANDROID_KEYSTORE_HOST_REQUIRED");
    expect(()=>new AndroidKeystoreKeyProvider(Buffer.alloc(31),"android")).toThrow("ROOT_SIZE_REJECTED");
    const provider=new AndroidKeystoreKeyProvider(randomBytes(32),"android");
    expect(()=>provider.loadKey("")).toThrow("CONTEXT_REJECTED");
    expect(()=>provider.loadKey("x".repeat(1025))).toThrow("CONTEXT_REJECTED");
    provider.destroy();expect(()=>provider.loadKey("a")).toThrow("PROVIDER_DESTROYED");
  });
  it("copies the supplied root and separates exact canonical contexts",()=>{
    const root=randomBytes(32),copy=Buffer.from(root);
    const first=new AndroidKeystoreKeyProvider(root,"android"),second=new AndroidKeystoreKeyProvider(copy,"android");
    root.fill(0);copy.fill(0);
    try {
      expect(first.loadKey("device:installation-a")).toEqual(second.loadKey("device:installation-a"));
      expect(first.loadKey("device:installation-a")).not.toEqual(first.loadKey("device:installation-b"));
    }finally{first.destroy();second.destroy();}
  });
  it("reopens canonical encrypted storage with the same root and denies a wrong root/context",()=>{
    const directory=mkdtempSync(join(tmpdir(),"camacho-android-custody-")),root=randomBytes(32);
    const providers=[new AndroidKeystoreKeyProvider(root,"android"),new AndroidKeystoreKeyProvider(root,"android"),new AndroidKeystoreKeyProvider(randomBytes(32),"android")];
    const stores:EncryptedFileSecretStore[]=[];
    try {
      const first=new EncryptedFileSecretStore(directory,providers[0]!,"installation-a:device-a");stores.push(first);
      first.write("fixture",Buffer.from("isolated-value"));first.destroy();
      const restored=new EncryptedFileSecretStore(directory,providers[1]!,"installation-a:device-a");stores.push(restored);
      expect(restored.read("fixture").toString()).toBe("isolated-value");
      const wrongRoot=new EncryptedFileSecretStore(directory,providers[2]!,"installation-a:device-a");stores.push(wrongRoot);
      expect(()=>wrongRoot.read("fixture")).toThrow("authentication failed");
      const wrongContext=new EncryptedFileSecretStore(directory,providers[1]!,"installation-b:device-a");stores.push(wrongContext);
      expect(()=>wrongContext.read("fixture")).toThrow("authentication failed");
    }finally{
      root.fill(0);for(const store of stores)store.destroy();for(const provider of providers)provider.destroy();
      const target=realpathSync(directory);
      if(dirname(target)!==realpathSync(tmpdir())||!basename(target).startsWith("camacho-android-custody-"))throw new Error("TEST_CLEANUP_PATH_REJECTED");
      rmSync(target,{recursive:true,force:true});
    }
  });
});
