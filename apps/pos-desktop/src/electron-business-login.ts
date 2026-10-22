import {app,safeStorage,shell} from "electron";
import type {NativeClientRegistration} from "@pos-platform/contracts";
import {NativeBusinessCredentialVault,beginNativeBusinessLogin,exchangeNativeBusinessCode} from "./native-business-login.js";

/** Privileged main only. Production bootstrap does not instantiate this without
 * approved deployment/browser registration. No auth material crosses preload. */
export function createElectronBusinessCredentialVault(){
  if(!app.isReady()||process.platform==="linux"&&["basic_text","unknown"].includes(safeStorage.getSelectedStorageBackend()))throw Error("NATIVE_OS_CUSTODY_UNAVAILABLE");
  return new NativeBusinessCredentialVault(safeStorage);
}
export function startElectronBusinessLogin(input:{registration:NativeClientRegistration;timeoutMs:number;exchangeTimeoutMs:number;vault:NativeBusinessCredentialVault}){
  return beginNativeBusinessLogin({...input,
    openSystemBrowser:url=>shell.openExternal(url,{activate:true}),
    exchange:(registration,request)=>exchangeNativeBusinessCode(registration,request,input.exchangeTimeoutMs),
  });
}
