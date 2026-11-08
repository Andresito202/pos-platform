import { useEffect, useState } from "react";
import { LocalOperatorResponseSchema } from "@pos-platform/contracts";
import { buildEnvelope, getPosService } from "../pos-service.js";

/**
 * Main renderer's local sign-out control. The account's identity and role
 * come exclusively from the service; the UI cannot assert either.
 */
export function LocalOperatorSessionControl({onSessionChanged}:{onSessionChanged:()=>void}):React.JSX.Element|null {
  const [username,setUsername]=useState<string|null>(null);
  const [busy,setBusy]=useState(false);
  useEffect(()=>{
    let live=true;
    void getPosService()["local.operator.session"](buildEnvelope("local.operator.session",{}))
      .then(value=>{
        const result=LocalOperatorResponseSchema.parse(value);
        if(live && result.status==="SUCCEEDED" && result.result?.outcome==="AUTHENTICATED"){
          setUsername(result.result.username);
        }
      }).catch(()=>{if(live)setUsername(null);});
    return ()=>{live=false;};
  },[]);
  if(!username)return null;
  const logout=async()=>{
    setBusy(true);
    // Immediately remove the privileged UI, even when channel fails.
    setUsername(null);
    try {
      const raw=await getPosService()["local.operator.logout"](buildEnvelope("local.operator.logout",{}));
      const result=LocalOperatorResponseSchema.parse(raw);
      if(result.status!=="SUCCEEDED" || result.result?.outcome!=="SIGNED_OUT")throw Error("LOCAL_LOGOUT_NOT_CONFIRMED");
    } catch {
      // Do not reactivate a former account. The user must close the desktop if
      // channel access is lost, and backend authorization remains authoritative.
    } finally {
      onSessionChanged();
      setBusy(false);
    }
  };
  return <div className="pos-local-session-control">
    <span title="Cuenta local de desarrollo">{username}</span>
    <button type="button" onClick={()=>void logout()} disabled={busy}>Cerrar sesión</button>
  </div>;
}
