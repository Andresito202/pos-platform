import {useState} from "react";
import {LicenseOfferDraftSchema,uuidV7,type LicenseOfferDraft} from "@pos-platform/contracts";
import type {PlatformClient,PublishedOffer} from "../platform-client.js";

/** Existing administration styles; no local price, activation or permission authority. */
export function PlatformOfferEditor({client,offers,onChanged}:{client:PlatformClient;offers:readonly PublishedOffer[];onChanged:()=>Promise<void>}){
  const [selected,setSelected]=useState<PublishedOffer|null>(null),[draft,setDraft]=useState<{id:string;version:number}|null>(null);
  const [busy,setBusy]=useState(false),[message,setMessage]=useState<string|null>(null),[error,setError]=useState<string|null>(null);
  const [revision,setRevision]=useState(0);
  async function save(form:HTMLFormElement){
    setBusy(true);setError(null);setMessage(null);
    try{
      const f=new FormData(form),model=String(f.get("billing_model"));
      const integer=(name:string)=>{const raw=String(f.get(name)??"");if(!/^\d+$/.test(raw)||!Number.isSafeInteger(Number(raw)))throw Error("Indica importes enteros válidos.");return Number(raw);};
      const offer:LicenseOfferDraft=LicenseOfferDraftSchema.parse({id:uuidV7(),code:f.get("code"),name:f.get("name"),billing_model:model,
        deployment_mode:model==="PERPETUAL"?"LOCAL_PERPETUAL":"HYBRID",currency_code:f.get("currency_code"),price_minor:integer("price_minor"),
        included_registers:1,additional_register_price_minor:integer("additional_register_price_minor"),support_price_minor:integer("support_price_minor"),
        support_charge:"OPTIONAL_SAME_TERM",policy_reference:f.get("policy_reference")});
      const result=await client.save(offer,selected?.version??0,uuidV7());
      if(result.planId!==offer.id||!Number.isSafeInteger(result.version)||Number(result.version)<1)throw Error("Central no confirmó la versión guardada.");
      setDraft({id:offer.id,version:Number(result.version)});setMessage("Central guardó el borrador. Todavía no está publicado ni activa una licencia.");
    }catch(e){setError(e instanceof Error?e.message:"No se pudo guardar el plan.");}finally{setBusy(false);}
  }
  async function publish(){
    const target=draft??(selected?.status==="DRAFT"?selected:null);
    if(!target)return;setBusy(true);setError(null);
    try{const result=await client.publish(target.id,target.version,uuidV7());
      if(result.planId!==target.id||result.version!==target.version)throw Error("Central no confirmó la publicación.");
      await onChanged();setDraft(null);setSelected(null);setRevision(v=>v+1);setMessage("Central publicó la versión del plan. No se ha realizado ningún cobro ni activación.");
    }catch(e){setError(e instanceof Error?e.message:"No se pudo publicar el plan.");}finally{setBusy(false);}
  }
  return <div className="pos-admin-surface">
    <h3>Planes, soporte y precios</h3>
    <p>Una caja incluida. Los importes se guardan como unidades mínimas de la moneda; deben corresponder a la política comercial aprobada.</p>
    <label>Plan del catálogo <select aria-label="Plan del catálogo" disabled={busy} value={selected?.id??""} onChange={e=>{
      setSelected(offers.find(o=>o.id===e.target.value)??null);setDraft(null);setMessage(null);setError(null);
    }}><option value="">Crear plan</option>{offers.map(o=><option key={o.id} value={o.id}>{o.name} · versión {o.version} · {o.status==="DRAFT"?"Borrador":"Publicado"}</option>)}</select></label>
    <form key={(selected?.id??"new")+":"+revision} onSubmit={e=>{e.preventDefault();void save(e.currentTarget);}}>
      <fieldset disabled={busy||draft!==null} className="pos-form-grid">
        <label>Código<input name="code" aria-label="Código del plan" required maxLength={96} title="Usa mayúsculas, números y separadores válidos." defaultValue={selected?.code??""} readOnly={selected!==null}/></label>
        <label>Nombre<input name="name" aria-label="Nombre del plan" required maxLength={160} defaultValue={selected?.name??""}/></label>
        <label>Modalidad<select name="billing_model" aria-label="Modalidad del plan" required defaultValue={selected?.billing_model??""}>
          <option value="" disabled>Seleccionar</option><option value="MONTHLY">Mensual</option><option value="ANNUAL">Anual</option><option value="PERPETUAL">Perpetuo</option></select></label>
        <label>Moneda<input name="currency_code" aria-label="Moneda" pattern="[A-Z]{3}" maxLength={3} required defaultValue={selected?.currency_code??""}/></label>
        <label>Precio base (unidades mínimas)<input name="price_minor" aria-label="Precio base" inputMode="numeric" pattern="[0-9]+" required defaultValue={selected?.price_minor??""}/></label>
        <label>Caja adicional (unidades mínimas)<input name="additional_register_price_minor" aria-label="Precio de caja adicional" inputMode="numeric" pattern="[0-9]+" required defaultValue={selected?.additional_register_price_minor??""}/></label>
        <label>Soporte (unidades mínimas)<input name="support_price_minor" aria-label="Precio de soporte" inputMode="numeric" pattern="[0-9]+" required defaultValue={selected?.support_price_minor??""}/></label>
        <label>Referencia de política aprobada<input name="policy_reference" aria-label="Referencia de política" required maxLength={128} defaultValue={selected?.policy_reference??""}/></label>
        <button type="submit">Guardar nueva versión</button>
      </fieldset>
    </form>
    <button type="button" onClick={()=>void publish()} disabled={busy||(!draft&&selected?.status!=="DRAFT")}>Publicar versión guardada</button>
    <button type="button" disabled={busy} onClick={()=>void onChanged().catch(()=>setError("No se pudo recuperar el catálogo desde Central."))}>Recuperar catálogo de Central</button>
    {message&&<p role="status">{message}</p>}{error&&<p role="alert">{error}</p>}
  </div>;
}
