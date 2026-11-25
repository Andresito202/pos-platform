import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EncryptedFileSecretStore } from "../src/security/encrypted-secret-store.js";
import { AndroidSessionCustody } from "../src/android/android-business-session-activation.js";

describe("Android durable session custody",()=>{
  it("recovers an active selector across reopen and preserves explicit logout",()=>{
    const directory=mkdtempSync(join(tmpdir(),"pos-session-"));
    const provider={protection:"OS_BOUND" as const,loadKey:()=>Buffer.alloc(32,7)};
    const open=()=>new AndroidSessionCustody(new EncryptedFileSecretStore(directory,provider,"android-session:test"));
    try{
      const first=open();
      expect(first.read()).toEqual({state:"CLOSED"});
      const marker={state:"ACTIVE" as const,userId:"11111111-1111-4111-8111-111111111111",sessionId:"22222222-2222-4222-8222-222222222222",ssaSequence:4,sasSequence:9};
      first.write(marker);
      first.destroy();
      const second=open();
      expect(second.read()).toEqual(marker);
      second.write({state:"CLOSED"});
      second.destroy();
      const third=open();
      expect(third.read()).toEqual({state:"CLOSED"});
      third.destroy();
    }finally{rmSync(directory,{recursive:true,force:true});}
  });
  it("rejects non-OS-bound custody",()=>{
    const directory=mkdtempSync(join(tmpdir(),"pos-session-"));
    const store=new EncryptedFileSecretStore(directory,{protection:"TEST_ONLY",loadKey:()=>Buffer.alloc(32)},"test");
    try{expect(()=>new AndroidSessionCustody(store)).toThrow("ANDROID_SESSION_OS_CUSTODY_REQUIRED");}
    finally{store.destroy();rmSync(directory,{recursive:true,force:true});}
  });
});
