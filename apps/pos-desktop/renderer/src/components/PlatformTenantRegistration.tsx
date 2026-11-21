import { useRef, useState } from "react";
import { uuidV7 } from "@pos-platform/contracts";
import type { PlatformClient } from "../platform-client.js";

type Request = Parameters<PlatformClient["initializeTenant"]>[0];
type Result = Awaited<ReturnType<PlatformClient["initializeTenant"]>>;

export function PlatformTenantRegistration(
  { client }: { client: PlatformClient }
) {
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState<string|null>(null);
  const [result,setResult]=useState<Result|null>(null);
  const pending=useRef<Request|null>(null);
  const running=useRef(false);

  async function submit(form:HTMLFormElement){
    if(running.current)return;

    const data=new FormData(form);
    const fields={
      tenantName:String(data.get("tenantName")??"").trim(),
      companyName:String(data.get("companyName")??"").trim(),
      branchName:String(data.get("branchName")??"").trim(),
      ownerEmail:String(data.get("ownerEmail")??"").trim(),
      ownerFullName:String(data.get("ownerFullName")??"").trim()
    };

    if(Object.values(fields).some(v=>!v)){
      setError("Completa todos los campos.");
      return;
    }

    if(!pending.current){
      pending.current={
        ...fields,
        idempotencyKey:uuidV7(),
        correlationId:uuidV7()
      };
    }

    if(Object.entries(fields).some(([key,value])=>
      pending.current?.[key as keyof Request]!==value)){
      setError("Existe una solicitud pendiente. Conserva sus datos para reintentar.");
      return;
    }

    running.current=true;
    setBusy(true);
    setError(null);

    try{
      const created=await client.initializeTenant(pending.current);
      setResult(created);
      pending.current=null;
      form.reset();
    }catch(e){
      setError(e instanceof Error?e.message:
        "No se pudo confirmar el registro empresarial.");
    }finally{
      running.current=false;
      setBusy(false);
    }
  }

  return <section aria-label="Registro de empresas">
    <h2>Registrar empresa</h2>

    <form onSubmit={e=>{
      e.preventDefault();
      void submit(e.currentTarget);
    }}>
      <fieldset disabled={busy}>
        <label>Nombre del negocio
          <input name="tenantName" required maxLength={200}/>
        </label>

        <label>Nombre comercial
          <input name="companyName" required maxLength={200}/>
        </label>

        <label>Sucursal principal
          <input name="branchName" required maxLength={200}/>
        </label>

        <label>Nombre del propietario
          <input name="ownerFullName" required maxLength={200}/>
        </label>

        <label>Correo del propietario
          <input name="ownerEmail" type="email"
            required maxLength={320}/>
        </label>

        <button type="submit">
          {busy?"Registrando empresa…":
            pending.current?"Reintentar registro":"Registrar empresa"}
        </button>
      </fieldset>
    </form>

    {error&&<p role="alert">{error}</p>}

    {result&&<section role="status">
      <h3>Empresa registrada</h3>
      <p>Estado: preparada para licenciamiento.</p>
      <p>Organización: {result.tenantId}</p>
      <p>Membresía del propietario: {result.tenantMembershipId}</p>
      <p>Empresa: {result.companyId}</p>
      <p>Sucursal: {result.branchId}</p>
    </section>}
  </section>;
}
