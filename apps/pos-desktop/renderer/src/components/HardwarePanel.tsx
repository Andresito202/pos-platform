import { useState } from "react";
import { callCommercial } from "../pos-service.js";
import { CanonicalPermission,type HardwareCommand } from "@pos-platform/contracts";

export function HardwarePanel({permissions}:{permissions:ReadonlySet<string>}):React.JSX.Element {
  const [busy,setBusy]=useState(false),[output,setOutput]=useState<unknown>(null),[error,setError]=useState<string|null>(null);
  const [binding,setBinding]=useState(""),[register,setRegister]=useState(""),[device,setDevice]=useState(""),[profile,setProfile]=useState("");
  const [sale,setSale]=useState(""),[reason,setReason]=useState(""),[job,setJob]=useState(""),[confirm,setConfirm]=useState(false);
  const permitted=(code:string)=>permissions.has(code);
  const run=async(command:HardwareCommand)=>{
    setBusy(true);setError(null);
    try {const result=await callCommercial<{kind:string;data:unknown;reason:string|null}>("hardware.command",command);
      setOutput(result.result);if(result.status==="REJECTED")setError(result.result?.reason??result.result_code);
    }catch(e){setError(e instanceof Error?e.message:String(e));}finally{setBusy(false);}
  };
  const enqueue=(kind:"PRINT_TEST"|"PRINT_RECEIPT"|"DRAWER_OPEN"|"CUT")=>{
    const id=crypto.randomUUID();setJob(id);
    void run({action:"enqueue",job_id:id,binding_id:binding,kind,sale_id:kind==="PRINT_RECEIPT"?sale:null,reason});
  };
  return <section data-testid="hardware-panel">
    <h2>Impresora y cajón</h2>
    <p>Una cola instalada no confirma un modelo compatible. Un trabajo aceptado no confirma impresión ni apertura física.</p>
    {permitted(CanonicalPermission.HARDWARE_READ) && <button disabled={busy} onClick={()=>void run({action:"diagnose"})}>Detectar y diagnosticar</button>}
    {permitted(CanonicalPermission.HARDWARE_READ) && <button disabled={busy} onClick={()=>void run({action:"list"})}>Consultar asociaciones y trabajos</button>}
    {permitted(CanonicalPermission.HARDWARE_CONFIGURE) && <fieldset disabled={busy}><legend>Asociación autorizada</legend>
      <label>Caja <input value={register} onChange={e=>setRegister(e.target.value)}/></label>
      <label>Dispositivo detectado <input value={device} onChange={e=>setDevice(e.target.value)}/></label>
      <label>Perfil verificado por el servicio <input value={profile} onChange={e=>setProfile(e.target.value)}/></label>
      <button onClick={()=>{const id=crypto.randomUUID();setBinding(id);void run({action:"associate",binding_id:id,cash_register_id:register,device_id:device,profile_id:profile});}}>Guardar asociación</button>
      <p>Sin adaptador y perfil del modelo configurados en el servicio, la asociación se rechaza.</p>
    </fieldset>}
    {(permitted(CanonicalPermission.HARDWARE_PRINT)||permitted(CanonicalPermission.HARDWARE_DRAWER_OPEN)) && <>
    <label>Asociación de esta caja <input value={binding} onChange={e=>setBinding(e.target.value)}/></label>
    <label>Venta para reimpresión <input value={sale} onChange={e=>setSale(e.target.value)}/></label>
    <label>Motivo <input value={reason} onChange={e=>setReason(e.target.value)} maxLength={200}/></label>
    {permitted(CanonicalPermission.HARDWARE_PRINT) && <button disabled={busy||!binding||reason.trim().length<3} onClick={()=>enqueue("PRINT_TEST")}>Encolar impresión de prueba</button>}
    {permitted(CanonicalPermission.HARDWARE_PRINT) && <button disabled={busy||!binding||!sale||reason.trim().length<3} onClick={()=>enqueue("PRINT_RECEIPT")}>Encolar recibo de venta persistida</button>}
    {permitted(CanonicalPermission.HARDWARE_DRAWER_OPEN) && <label><input type="checkbox" checked={confirm} onChange={e=>setConfirm(e.target.checked)}/>Confirmo una solicitud manual de apertura en esta caja</label>}
    {permitted(CanonicalPermission.HARDWARE_DRAWER_OPEN) && <button disabled={busy||!binding||!confirm||reason.trim().length<3} onClick={()=>enqueue("DRAWER_OPEN")}>Encolar apertura autorizada</button>}
    <label>Trabajo <input value={job} onChange={e=>setJob(e.target.value)}/></label>
    <button disabled={busy||!job||( !permitted(CanonicalPermission.HARDWARE_PRINT) && !permitted(CanonicalPermission.HARDWARE_DRAWER_OPEN))} onClick={()=>void run({action:"dispatch",job_id:job})}>Ejecutar trabajo pendiente</button>
    </>}
    <p>Los trabajos inciertos no se reenvían al reconectar. Verifica el periférico y solicita una nueva operación autorizada si corresponde. Sin sensor no hay confirmación de apertura.</p>
    {error&&<p role="alert">{error}</p>}
    <pre aria-live="polite">{output===null?"Sin diagnóstico ejecutado":JSON.stringify(output,null,2)}</pre>
  </section>;
}
