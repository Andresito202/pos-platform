// Dedicated custody test host. Does not load the POS, a device identity or a DB.
import {app} from "electron";
import {resolve} from "node:path";
import {randomBytes} from "node:crypto";
if(!process.env.CAMACHO_CUSTODY_TEST_DIRECTORY)throw Error("DEDICATED_TEST_PROFILE_REQUIRED");
app.setPath("userData",resolve(process.env.CAMACHO_CUSTODY_TEST_DIRECTORY));
void app.whenReady().then(async()=>{try{
  const {createElectronBusinessCredentialVault}=await import("../dist/electron-business-login.js");
  const vault=createElectronBusinessCredentialVault();
  const secret=randomBytes(48).toString("base64url");
  const fixtureAccess=Array.from({length:3},()=>randomBytes(24).toString("base64url")).join(".");
  vault.replace({accessToken:fixtureAccess,refreshToken:secret});
  const restored=await vault.use(async tokens=>tokens.refreshToken===secret);
  vault.clear();const empty=await vault.use(async()=>true);
  globalThis.nativeCustodyResult={platform:process.platform,restored,cleared:empty===null};
}catch{
  globalThis.nativeCustodyResult={platform:process.platform,restored:false,cleared:false};
}});
