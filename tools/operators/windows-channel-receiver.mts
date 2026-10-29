/** Explicit operator preparation, never called by Desktop/Service startup. */
import { existsSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { prepareWindowsHandoffReceiver, recoverWindowsHandoffReceiverPublic } from "../../packages/local-channel/src/windows-handoff.js";

const [operation,privateFile,publicFile,...extra]=process.argv.slice(2);
if(!["--prepare","--recover-public"].includes(operation??"")||!privateFile||!publicFile||extra.length){
  console.error("Usage: windows-channel-receiver.mts --prepare|--recover-public <private receiver file> <new public enrollment file>. Requires genuine POS_INSTALLATION_ID and POS_DEVICE_ID; directory must have protected owner-only ACL. No Service activation.");
  process.exitCode=2;
}else{
  try{
    const root=realpathSync(resolve(dirname(fileURLToPath(import.meta.url)),"../.."));
    if(resolve(privateFile).toLowerCase()===resolve(publicFile).toLowerCase())throw Error("DISTINCT_RECEIVER_FILES_REQUIRED");
    for(const file of [privateFile,publicFile]){
      if(!isAbsolute(file)||((file===publicFile||operation==="--prepare")&&existsSync(file)))throw Error("RECEIVER_NEW_ABSOLUTE_FILES_REQUIRED");
      const parent=realpathSync(dirname(file));
      const rel=relative(root,parent);
      if(rel===""||(!(rel===".."||rel.startsWith(".."+sep))&&!isAbsolute(rel)))throw Error("RECEIVER_MUST_BE_OUTSIDE_REPOSITORY");
    }
    if(dirname(privateFile)!==dirname(publicFile))throw Error("RECEIVER_SHARED_PRIVATE_DIRECTORY_REQUIRED");
    const prepare=operation==="--prepare"?prepareWindowsHandoffReceiver:recoverWindowsHandoffReceiverPublic;
    const value=prepare(privateFile,process.env.POS_INSTALLATION_ID??"",process.env.POS_DEVICE_ID??"");
    // Only public enrollment metadata; private key remains DPAPI CurrentUser.
    writeFileSync(publicFile,JSON.stringify(value,null,2),{flag:"wx",mode:0o600});
    console.log("RECEIVER_PREPARED; SCM commercial login remains blocked; no production or human certification.");
  }catch{
    // Never relay native diagnostics or cryptographic inputs.
    console.error("RECEIVER_PREPARATION_REJECTED; inspect paths, existing files, token, IDs and directory ACL locally. Existing files were not overwritten.");
    process.exitCode=2;
  }
}
