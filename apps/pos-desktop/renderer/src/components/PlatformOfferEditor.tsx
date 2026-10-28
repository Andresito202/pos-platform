import {useState} from "react";
import {LicenseOfferV2Schema,formatCopPesos,parseCopPesos,uuidV7,type LicenseOfferDraft} from "@pos-platform/contracts";
import type {PlatformClient,PublishedOffer} from "../platform-client.js";

/** Existing styles. SQL, not this form, publishes price authority. */
export function PlatformOfferEditor({client,offers,onChanged}:{client:PlatformClient;offers:readonly PublishedOffer[];onChanged:()=>Promise<void>}){
  const [selected,setSelected]=useState<PublishedOffer|null>(null),[draft,setDraft]=useState<{id:string;version:number}|null>(null);
  const [preview,setPreview]=useState<LicenseOfferDraft|null>(null),[confirmed,setConfirmed]=useState(false),[revision,setRevision]=useState(0);
  const [busy,setBusy]=useState(false),[message,setMessage]=useState<string|null>(null),[error,setError]=useState<string|null>(null);
  const legacy=selected!==null&&!("profile" in selected);
  function choose(offer:PublishedOffer|null){setSelected(offer);setDraft(null);setPreview(null);setConfirmed(false);setMessage(null);setError(null);}
  function review(form:HTMLFormElement){
    setError(null);setMessage(null);
    try{const f=new FormData(form),model=String(f.get("billing_model"));
      const result=LicenseOfferV2Schema.safeParse({id:uuidV7(),code:f.get("code"),name:f.get("name"),billing_model:model,deployment_mode:model==='PERPETUAL'?"LOCAL_PERPETUAL":"HYBRID",
        currency_code:"COP",currency_exponent:2,price_minor:parseCopPesos(String(f.get("price_minor"))),included_registers:1,
        additional_register_price_minor:parseCopPesos(String(f.get("additional_register_price_minor"))),support_price_minor:parseCopPesos(String(f.get("support_price_minor"))),
        support_charge:model==='PERPETUAL'?"OPTIONAL_12_MONTHS":"OPTIONAL_SAME_TERM",support_term_months:model==='MONTHLY'?1:12,
        policy_reference:f.get("policy_reference"),profile:"CAMACHO_LICENSE_OFFER_V2",publication_scope:"PREPRODUCTION"});
      if(!result.success)throw Error("Revisa código, modalidad, importes y referencia de política.");setPreview(result.data);
    }catch(e){setError(e instanceof Error?e.message:"No se pudo revisar el plan.");}
  }
  async function save(){
    if(!preview)return;setBusy(true);setError(null);
    try{const result=await client.save(preview,selected?.version??0,uuidV7());
      if(result.planId!==preview.id||!Number.isSafeInteger(result.version)||Number(result.version)<1)throw Error("Central no confirmó la versión guardada.");
      setDraft({id:preview.id,version:Number(result.version)});setPreview(null);setConfirmed(false);
      setMessage("Central guardó el borrador. Todavía no está publicado ni activa una licencia.");await onChanged();
    }catch(e){setError(e instanceof Error?e.message:"No se pudo guardar el plan.");}finally{setBusy(false);}
  }
  async function publish(){
    const target=draft??(selected?.status==='DRAFT'?selected:null);if(!target||!confirmed)return;setBusy(true);setError(null);
    try{const result=await client.publish(target.id,target.version,uuidV7());
      if(result.planId!==target.id||result.version!==target.version)throw Error("Central no confirmó la publicación.");
      setDraft(null);setSelected(null);setPreview(null);setConfirmed(false);setRevision(v=>v+1);
      setMessage("Central publicó la versión del plan. No se ha realizado ningún cobro ni activación.");await onChanged();
    }catch(e){setError(e instanceof Error?e.message:"No se pudo publicar el plan.");}finally{setBusy(false);}
  }
  async function initialize(){setBusy(true);setError(null);
    try{const result=await client.initializePreproduction();if(result.status!=="DRAFTS_ONLY")throw Error("Central no confirmó los borradores.");
      setMessage("Catálogo inicial recuperado de Central. Los borradores requieren publicación explícita.");await onChanged();}
    catch(e){setError(e instanceof Error?e.message:"No se pudo preparar el catálogo.");}finally{setBusy(false);}}
  const codes=[...new Set(offers.filter(p=>"profile" in p).map(p=>p.code))];
  const active=selected?offers.find(p=>p.code===selected.code&&p.status==='ACTIVE'):null;
  return <section className="pos-admin-surface" data-testid="platform-offer-editor"><h2>Licencias → Planes y precios</h2>
    <p>Preproducción · COP · una caja incluida. Impuestos pendientes; cobros productivos deshabilitados.</p>
    <button type="button" disabled={busy} onClick={()=>void initialize()}>Preparar catálogo preproducción</button>
    <div className="pos-admin-grid">{codes.map(code=>{const rows=offers.filter(p=>p.code===code),current=rows.find(p=>p.status==='ACTIVE')??rows[0]!,edit=rows.find(p=>p.status==='DRAFT')??current;
      return <article key={code} className="pos-admin-card" data-admin-plan-code={code}><h3>{current.name}</h3><strong>$ {formatCopPesos(current.price_minor)} COP</strong>
        <p>Una caja incluida · adicional $ {formatCopPesos(current.additional_register_price_minor)} COP</p><p>Soporte opcional $ {formatCopPesos(current.support_price_minor)} COP</p>
        <small>{current.status==='ACTIVE'?"Publicado":"Borrador"} · versión {current.version} · {current.published_at?new Date(current.published_at).toLocaleString("es-CO"):"Sin publicación"}</small>
        {current.id!==edit.id&&<p>Borrador pendiente: versión {edit.version}</p>}
        <button type="button" disabled={busy} onClick={()=>choose(edit)}>Revisar y editar {current.name}</button></article>;})}</div>
    <label>Plan del catálogo <select aria-label="Plan del catálogo" disabled={busy} value={selected?.id??""} onChange={e=>choose(offers.find(o=>o.id===e.target.value)??null)}>
      <option value="">Crear plan</option>{offers.map(o=><option key={o.id} value={o.id}>{o.name} · versión {o.version} · {o.status==='DRAFT'?"Borrador":"Publicado"}{!("profile" in o)?" · histórico V1":""}</option>)}</select></label>
    {legacy?<p role="status">Versión histórica sin escala publicada: no se reinterpretan sus importes ni condiciones.</p>:<form key={(selected?.id??"new")+":"+revision} onSubmit={e=>{e.preventDefault();review(e.currentTarget);}}>
      <fieldset disabled={busy||draft!==null||preview!==null} className="pos-form-grid">
        <label>Código<input name="code" aria-label="Código del plan" required maxLength={96} defaultValue={selected?.code??""} readOnly={selected!==null}/></label>
        <label>Nombre<input name="name" aria-label="Nombre del plan" required maxLength={160} defaultValue={selected?.name??""}/></label>
        <label>Modalidad<select name="billing_model" aria-label="Modalidad del plan" required defaultValue={selected?.billing_model??""}>
          <option value="" disabled>Seleccionar</option><option value="MONTHLY">Mensual</option><option value="ANNUAL">Anual</option><option value="PERPETUAL">Perpetuo</option></select></label>
        <label>Precio base (COP)<input name="price_minor" aria-label="Precio base" inputMode="decimal" required defaultValue={selected?formatCopPesos(selected.price_minor):""}/></label>
        <label>Caja adicional (COP)<input name="additional_register_price_minor" aria-label="Precio de caja adicional" inputMode="decimal" required defaultValue={selected?formatCopPesos(selected.additional_register_price_minor):""}/></label>
        <label>Soporte opcional (COP)<input name="support_price_minor" aria-label="Precio de soporte" inputMode="decimal" required defaultValue={selected?formatCopPesos(selected.support_price_minor):""}/></label>
        <label>Referencia de política<input name="policy_reference" aria-label="Referencia de política" required maxLength={128} defaultValue={selected?.policy_reference??""}/></label>
        <button type="submit">Revisar cambios</button>
      </fieldset></form>}
    {preview&&<div className="pos-admin-surface" data-testid="offer-preview"><h3>Vista previa · sin guardar</h3><p>{preview.name}: $ {formatCopPesos(preview.price_minor)} COP</p>
      <p>{active?"Publicado: $ "+formatCopPesos(active.price_minor)+" → propuesta: $ "+formatCopPesos(preview.price_minor):"Nueva versión sin publicación previa"}</p>
      <p>Adicional $ {formatCopPesos(preview.additional_register_price_minor)} · soporte $ {formatCopPesos(preview.support_price_minor)} COP · {"support_term_months" in preview?preview.support_term_months:"—"} meses</p>
      <button type="button" disabled={busy} onClick={()=>void save()}>Guardar borrador</button><button type="button" disabled={busy} onClick={()=>setPreview(null)}>Cancelar edición</button></div>}
    <label><input type="checkbox" aria-label="Confirmar publicación" checked={confirmed} disabled={busy||(!draft&&selected?.status!=='DRAFT')} onChange={e=>setConfirmed(e.target.checked)}/>Confirmo publicar esta versión de precio.</label>
    <button type="button" onClick={()=>void publish()} disabled={busy||!confirmed||(!draft&&selected?.status!=='DRAFT')}>Publicar versión guardada</button>
    <button type="button" disabled={busy} onClick={()=>void onChanged().catch(()=>setError("No se pudo recuperar el catálogo desde Central."))}>Recuperar catálogo de Central</button>
    {message&&<p role="status">{message}</p>}{error&&<p role="alert">{error}</p>}
  </section>;
}
