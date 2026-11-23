import {useEffect,useState} from "react";
import {formatCopPesos,uuidV7,UuidSchema} from "@pos-platform/contracts";
import type {PlatformClient,PublishedOffer} from "../platform-client.js";

/** GLOBAL quote → open Factus collection when provisioned → verify provider/inbox. */
export function PlatformSubscriptionQuote({
  client,offers,
}:{client:PlatformClient;offers:readonly PublishedOffer[]}):React.JSX.Element{
  const published=offers.filter(offer=>offer.status==="ACTIVE");
  const [tenantId,setTenantId]=useState("");
  const [companyId,setCompanyId]=useState("");
  const [planId,setPlanId]=useState(published[0]?.id??"");
  const [registers,setRegisters]=useState("0");
  const [support,setSupport]=useState(false);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState<string|null>(null);
  const [quote,setQuote]=useState<Awaited<ReturnType<PlatformClient["createSubscriptionQuote"]>>|null>(null);
  const [verified,setVerified]=useState<Awaited<ReturnType<PlatformClient["verifySubscriptionPayment"]>>|null>(null);
  const [pending,setPending]=useState<Awaited<ReturnType<PlatformClient["listPendingSubscriptionPayments"]>>>([]);
  const selected=published.find(offer=>offer.id===planId)??null;

  async function refreshPending(){
    try{setPending(await client.listPendingSubscriptionPayments());}
    catch{/* pending list is advisory for recovery; create/verify remain primary */}
  }

  useEffect(()=>{void refreshPending();},[client]);

  async function createQuote(){
    if(busy||!selected)return;
    const tenant=UuidSchema.safeParse(tenantId.trim());
    const company=UuidSchema.safeParse(companyId.trim());
    const extra=Number.parseInt(registers,10);
    if(!tenant.success||!company.success){setError("Indica tenant y empresa válidos del cliente registrado.");return;}
    if(!Number.isSafeInteger(extra)||extra<0||extra>10000){setError("Las cajas adicionales deben ser un entero entre 0 y 10000.");return;}
    setBusy(true);setError(null);setVerified(null);
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
      await refreshPending();
    }catch(failure){
      setError(failure instanceof Error?failure.message:"No se pudo abrir la cotización en Central.");
    }finally{setBusy(false);}
  }

  async function recoverCollection(paymentId:string){
    if(busy)return;
    setBusy(true);setError(null);setVerified(null);
    try{
      const recovered=await client.recoverSubscriptionCollection({
        payment_id:paymentId,
        correlation_id:uuidV7(),
      });
      setQuote({
        quoteId:recovered.quoteId,
        paymentId:recovered.paymentId,
        totalMinor:recovered.totalMinor,
        currencyCode:"COP",
        expiresAt:recovered.expiresAt,
        quoteChecksum:"",
        providerReference:recovered.providerReference,
        providerOpenStatus:"OPENED",
        qr:recovered.qr,
        paymentStatus:"PENDING",
        idempotent:true,
      });
    }catch(failure){
      setError(failure instanceof Error?failure.message:"No se pudo recuperar el QR del recaudo.");
    }finally{setBusy(false);}
  }

  async function verifyPayment(){
    if(busy||!quote)return;
    setBusy(true);setError(null);
    try{
      setVerified(await client.verifySubscriptionPayment({
        payment_id:quote.paymentId,
        correlation_id:uuidV7(),
      }));
      await refreshPending();
    }catch(failure){
      setError(failure instanceof Error?failure.message:"El cobro no está verificado. La licencia no puede emitirse.");
    }finally{setBusy(false);}
  }

  function downloadQr(){
    if(!quote?.qr)return;
    const anchor=document.createElement("a");
    anchor.href=quote.qr;
    anchor.download=`factus-pay-qr-${quote.paymentId.slice(0,8)}.png`;
    anchor.rel="noopener";
    anchor.click();
  }

  return <section className="pos-admin-surface" aria-label="Cotización y verificación de pago">
    <h3>Cotizar licencia y verificar cobro FACTUS Pay</h3>
    <p>Central toma el precio del plan publicado. Una referencia escrita a mano no confirma el pago: solo el proveedor o el inbox de webhooks autorizados.</p>
    <p role="note">Canal móvil: este panel GLOBAL HTTPS ya muestra el QR autenticado. El simulador oficial de FACTUS exige cámara y <strong>no importa imágenes</strong>; con un solo teléfono hace falta una segunda superficie (otra pantalla/impresión) para escanear.</p>
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
      <button type="button" disabled={busy||!selected} onClick={()=>void createQuote()}>Abrir cotización</button>
    </fieldset>
    {pending.length>0&&<section aria-label="Cotizaciones pendientes">
      <h4>Pendientes recuperables</h4>
      <ul>
        {pending.map(row=><li key={row.paymentId}>
          Empresa {row.companyId.slice(0,8)}… · $ {formatCopPesos(row.totalMinor)} · vence {new Date(row.expiresAt).toLocaleString("es-CO")}
          <button type="button" disabled={busy} onClick={()=>void recoverCollection(row.paymentId)}>Recuperar QR</button>
        </li>)}
      </ul>
    </section>}
    {quote&&<section aria-label="Cotización abierta">
      <p role="status">Cotización {quote.quoteId}. Pago pendiente {quote.paymentId}. Total $ {formatCopPesos(quote.totalMinor)} {quote.currencyCode}. Vence {new Date(quote.expiresAt).toLocaleString("es-CO")}.{quote.idempotent?" Recuperada por idempotencia.":""}</p>
      {quote.providerOpenStatus==="OPENED"&&quote.qr
        ?<p role="status">Cobro FACTUS abierto. Guarda o muestra el QR en otra superficie; escanea con el simulador oficial desde Android.</p>
        :quote.providerOpenStatus==="OPENED"
          ?<p role="status">Cobro FACTUS abierto (referencia {quote.providerReference}). Verifica cuando el proveedor reporte paid.</p>
          :<p role="status">El cobro permanece pendiente: proveedor {quote.providerOpenStatus==="NOT_CONFIGURED"?"no configurado":"no disponible"}. No se presenta como QR cobrable ni se puede emitir licencia.</p>}
      {quote.providerOpenStatus==="OPENED"&&quote.qr&&<>
        <img alt="QR de cobro FACTUS Pay" src={quote.qr} width={220} height={220}/>
        <button type="button" disabled={busy} onClick={downloadQr}>Descargar QR PNG</button>
      </>}
      <button type="button" disabled={busy||verified!==null} onClick={()=>void verifyPayment()}>Verificar cobro y emitir licencia</button>
    </section>}
    {verified&&<p role="status">Pago {verified.paymentId} verificado ({verified.source??"autoritativo"}) para la cotización {verified.quoteId}. Licencia {verified.licenseId} · contrato {verified.contractStatus}. Activación del dispositivo: {verified.activationStatus}.{verified.idempotent?" Verificación idempotente.":""}{verified.licenseIdempotent?" Licencia recuperada.":""}{verified.reconciliation?` Conciliación: ${verified.reconciliation}.`:""}</p>}
    {busy&&<p role="status">Procesando en Central…</p>}
    {error&&<p role="alert">{error}</p>}
  </section>;
}
