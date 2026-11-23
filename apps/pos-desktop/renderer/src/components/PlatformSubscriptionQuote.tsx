import {useState} from "react";
import {formatCopPesos,uuidV7,UuidSchema} from "@pos-platform/contracts";
import type {PlatformClient,PublishedOffer} from "../platform-client.js";

/** GLOBAL quote → open payment → confirm evidence. Does not invent catalog prices. */
export function PlatformSubscriptionQuote({
  client,offers,
}:{client:PlatformClient;offers:readonly PublishedOffer[]}):React.JSX.Element{
  const published=offers.filter(offer=>offer.status==="ACTIVE");
  const [tenantId,setTenantId]=useState("");
  const [companyId,setCompanyId]=useState("");
  const [planId,setPlanId]=useState(published[0]?.id??"");
  const [registers,setRegisters]=useState("0");
  const [support,setSupport]=useState(false);
  const [observation,setObservation]=useState("");
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState<string|null>(null);
  const [quote,setQuote]=useState<Awaited<ReturnType<PlatformClient["createSubscriptionQuote"]>>|null>(null);
  const [confirmed,setConfirmed]=useState<Awaited<ReturnType<PlatformClient["confirmSubscriptionPayment"]>>|null>(null);
  const selected=published.find(offer=>offer.id===planId)??null;

  async function createQuote(){
    if(busy||!selected)return;
    const tenant=UuidSchema.safeParse(tenantId.trim());
    const company=UuidSchema.safeParse(companyId.trim());
    const extra=Number.parseInt(registers,10);
    if(!tenant.success||!company.success){setError("Indica tenant y empresa válidos del cliente registrado.");return;}
    if(!Number.isSafeInteger(extra)||extra<0||extra>10000){setError("Las cajas adicionales deben ser un entero entre 0 y 10000.");return;}
    setBusy(true);setError(null);setConfirmed(null);
    try{
      setQuote(await client.createSubscriptionQuote({
        id:uuidV7(),
        tenant_id:tenant.data,
        company_id:company.data,
        plan_id:selected.id,
        plan_version:selected.version,
        selection:{additional_registers:extra,support},
        idempotency_key:uuidV7(),
        correlation_id:uuidV7(),
      }));
    }catch(failure){
      setError(failure instanceof Error?failure.message:"No se pudo abrir la cotización en Central.");
    }finally{setBusy(false);}
  }

  async function confirmPayment(){
    if(busy||!quote)return;
    if(observation.trim().length<1){setError("Registra la referencia de evidencia del pago recibido.");return;}
    setBusy(true);setError(null);
    try{
      setConfirmed(await client.confirmSubscriptionPayment({
        payment_id:quote.paymentId,
        observation_reference:observation.trim(),
        correlation_id:uuidV7(),
      }));
    }catch(failure){
      setError(failure instanceof Error?failure.message:"No se pudo confirmar la evidencia de pago.");
    }finally{setBusy(false);}
  }

  return <section className="pos-admin-surface" aria-label="Cotización y evidencia de pago">
    <h3>Cotizar licencia y registrar evidencia de pago</h3>
    <p>Central toma el precio del plan publicado. Esta pantalla no inventa importes ni emite la licencia: tras confirmar el pago, usa el identificador en Emisión.</p>
    <fieldset disabled={busy||quote!==null} className="pos-form-grid">
      <legend>Cliente y plan publicado</legend>
      <label className="pos-field">Tenant del cliente<input aria-label="Tenant del cliente" value={tenantId} maxLength={36} onChange={e=>setTenantId(e.target.value)}/></label>
      <label className="pos-field">Empresa del cliente<input aria-label="Empresa del cliente" value={companyId} maxLength={36} onChange={e=>setCompanyId(e.target.value)}/></label>
      <label className="pos-field">Plan publicado<select aria-label="Plan publicado" value={planId} onChange={e=>setPlanId(e.target.value)}>
        <option value="">Seleccionar plan</option>
        {published.map(offer=><option key={offer.id} value={offer.id}>{offer.name} · v{offer.version} · $ {formatCopPesos(offer.price_minor)}</option>)}
      </select></label>
      <label className="pos-field">Cajas adicionales<input aria-label="Cajas adicionales" inputMode="numeric" value={registers} onChange={e=>setRegisters(e.target.value)}/></label>
      <label><input type="checkbox" checked={support} onChange={e=>setSupport(e.target.checked)}/>Incluir soporte opcional del catálogo</label>
      <button type="button" disabled={busy||!selected} onClick={()=>void createQuote()}>Abrir cotización y cobro</button>
    </fieldset>
    {quote&&<section aria-label="Cotización abierta">
      <p role="status">Cotización {quote.quoteId}. Pago pendiente {quote.paymentId}. Total $ {formatCopPesos(quote.totalMinor)} {quote.currencyCode}. Vence {new Date(quote.expiresAt).toLocaleString("es-CO")}.{quote.idempotent?" Recuperada por idempotencia.":""}</p>
      <label className="pos-field">Referencia de evidencia de pago<input aria-label="Referencia de evidencia de pago" value={observation} maxLength={160} disabled={busy||confirmed!==null} onChange={e=>setObservation(e.target.value)}/></label>
      <button type="button" disabled={busy||confirmed!==null||!observation.trim()} onClick={()=>void confirmPayment()}>Confirmar evidencia en Central</button>
    </section>}
    {confirmed&&<p role="status">Pago {confirmed.paymentId} confirmado para la cotización {confirmed.quoteId}.{confirmed.idempotent?" Confirmación idempotente.":" Listo para emitir la licencia con este pago."}</p>}
    {busy&&<p role="status">Procesando en Central…</p>}
    {error&&<p role="alert">{error}</p>}
  </section>;
}
