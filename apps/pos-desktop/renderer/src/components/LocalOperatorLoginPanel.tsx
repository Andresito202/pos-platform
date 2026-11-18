import { useEffect, useState, type FormEvent } from "react";
import { LocalOperatorResponseSchema } from "@pos-platform/contracts";
import { buildEnvelope, getPosService } from "../pos-service.js";

type Operator = { username: string; role: string; expiresAt: string | null };


async function requestOperator(
  method: "local.operator.login" | "local.operator.session" | "local.operator.logout",
  payload: Record<string, string>,
) {
  const raw=await getPosService()[method](buildEnvelope(method,payload));
  const response=LocalOperatorResponseSchema.parse(raw);
  if(response.status!=="SUCCEEDED" || !response.result)throw Error("LOCAL_LOGIN_RESPONSE_INVALID");
  return response.result;
}

/**
 * Genuine backend credential verification over the authenticated Local Service
 * channel. It does not claim a central BUSINESS session or unlock commercial
 * functions until those independent permissions have been granted by the service.
 */
export function LocalOperatorLoginPanel({onAuthenticated}: {onAuthenticated?:()=>void}): React.JSX.Element {
  const [username,setUsername]=useState("");
  const [password,setPassword]=useState("");
  const [passwordVisible,setPasswordVisible]=useState(false);
  const [operator,setOperator]=useState<Operator|null>(null);
  const [loading,setLoading]=useState(true);
  const [supported,setSupported]=useState(false);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState("");

  useEffect(()=>{
    let active=true;
    void requestOperator("local.operator.session",{}).then(result=>{
      if(!active)return;
      setSupported(result.outcome!=="UNAVAILABLE");
      if(result.outcome==="AUTHENTICATED" && result.username && result.role){
        setOperator({username:result.username,role:result.role,expiresAt:result.expires_at});
      }
      else if(result.outcome==="UNAVAILABLE")setMessage("El login local no está provisionado en este servicio.");
    }).catch(()=>{
      if(active)setMessage("No se pudo consultar la sesión en el servicio local.");
    }).finally(()=>{if(active)setLoading(false);});
    return ()=>{active=false;};
  },[]);

  async function submit(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if(busy || loading)return;
    const submittedPassword=password;
    setPassword("");
    setPasswordVisible(false);
    setBusy(true);
    setMessage("");
    try {
      const response=await requestOperator("local.operator.login",{username,password:submittedPassword});
      if(response.outcome==="AUTHENTICATED"&&response.username&&response.role){
        setOperator({username:response.username,role:response.role,expiresAt:response.expires_at});
        onAuthenticated?.();
      }else if(response.outcome==="RATE_LIMITED"){
        setMessage("Demasiados intentos. El bloqueo temporal se aplica desde el servicio.");
      }else if(response.outcome==="UNAVAILABLE"){
        setMessage("El servicio no tiene autenticación local configurada.");
      }else {
        setMessage("Usuario o contraseña incorrectos.");
      }
    }catch{
      setMessage("No fue posible verificar las credenciales con el servicio.");
    }finally{setBusy(false);}
  }

  async function logout(){
    setBusy(true);
    setMessage("");
    // Fail closed in the UI even when transport is no longer available.
    setOperator(null);
    try{await requestOperator("local.operator.logout",{});}
    catch{setMessage("No se confirmó el cierre remoto. Cierra el POS para invalidar la conexión.");}
    finally{setBusy(false);}
  }

  return (
    <section className="pos-local-login" aria-label="Acceso de operador local">
      {loading ? <p role="status">Consultando sesión local…</p> : !supported ? (
        <p role="status">Acceso local no habilitado para este servicio.</p>
      ) : operator ? (
        <>
          <h3>Sesión local activa</h3>
          <p><strong>{operator.username}</strong> · {operator.role}</p>
          <p>Autenticación local confirmada. Los permisos operativos se verifican en el backend.</p>
          <button type="button" disabled={busy} onClick={()=>void logout()}>Cerrar sesión local</button>
        </>
      ) : (
        <form onSubmit={event=>void submit(event)}>
          <label htmlFor="pos-local-username">Usuario</label>
          <input id="pos-local-username" autoComplete="username" value={username}
            onChange={event=>setUsername(event.target.value)} disabled={busy} required
            placeholder="Ingresa tu usuario" maxLength={64} autoCapitalize="none" spellCheck={false}/>
          <label htmlFor="pos-local-password">Contraseña</label>
          <div className="pos-password-field"><input id="pos-local-password" type={passwordVisible ? "text" : "password"} autoComplete="current-password"
            value={password} onChange={event=>setPassword(event.target.value)}
            disabled={busy} required maxLength={512} placeholder="Ingresa tu contraseña"/>
            <button type="button" aria-label={passwordVisible ? "Ocultar contraseña" : "Mostrar contraseña"}
              aria-pressed={passwordVisible} onClick={()=>setPasswordVisible(value=>!value)} disabled={busy}>
              <img src={passwordVisible ? new URL("../assets/payment-icons/eye-off.svg", import.meta.url).href : new URL("../assets/payment-icons/eye.svg", import.meta.url).href} alt="" />
            </button></div>
          <button type="submit" disabled={busy}>{busy?"Verificando…":"Ingresar"}</button>
        </form>
      )}
      {message && <p role="status" className="pos-local-login-message">{message}</p>}
      <small>Instalación local de desarrollo. No acredita certificación comercial, fiscal ni SCM.</small>
    </section>
  );
}
