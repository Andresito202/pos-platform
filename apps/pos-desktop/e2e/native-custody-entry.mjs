// Dedicated custody test host: isolated random credentials; never logs material.
// The probe is bundled specifically for E2E and excludes Electron as external.
import {app} from "electron";
import {resolve} from "node:path";
import {randomBytes} from "node:crypto";
if(!process.env.CAMACHO_CUSTODY_TEST_DIRECTORY)throw Error("DEDICATED_TEST_PROFILE_REQUIRED");
app.setPath("userData",resolve(process.env.CAMACHO_CUSTODY_TEST_DIRECTORY));
void app.whenReady().then(async()=>{
  let phase="MODULE_IMPORT";
  try{
    const {createElectronBusinessCredentialVault}=await import("../dist/native-business-custody-probe.mjs");
    phase="CUSTODY_CREATE";
    const vault=createElectronBusinessCredentialVault();
    const secret=randomBytes(48).toString("base64url");
    const fixtureAccess=Array.from({length:3},()=>randomBytes(24).toString("base64url")).join(".");
    phase="CUSTODY_REPLACE";
    vault.replace({accessToken:fixtureAccess,refreshToken:secret});
    phase="CUSTODY_RESTORE";
    const restored=await vault.use(async tokens=>tokens.refreshToken===secret);
    phase="CUSTODY_CLEAR";
    vault.clear();
    const empty=await vault.use(async()=>true);
    globalThis.nativeCustodyResult={platform:process.platform,restored,cleared:empty===null,phase:"COMPLETE"};
  }catch{
    // Never report error.message, paths, PII or cryptographic data.
    globalThis.nativeCustodyResult={platform:process.platform,restored:false,cleared:false,phase};
  }
});
