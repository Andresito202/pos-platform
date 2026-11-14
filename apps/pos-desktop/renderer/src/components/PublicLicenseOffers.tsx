import {useEffect,useState} from "react";
import {formatCopPesos,type PublicLicenseOffer} from "@pos-platform/contracts";
import {PublicLicenseClient} from "../public-license-client.js";
export function LicenseOfferCards({offers}:{offers:readonly PublicLicenseOffer[]}){
  return <div className="pos-admin-grid">{offers.map(p=><article className="pos-admin-card" key={p.id} data-plan-code={p.code} data-plan-version={p.version}>
    <h3>{p.name}</h3><strong data-price-minor={p.price_minor}>$ {formatCopPesos(p.price_minor)} COP</strong>
    <p>{p.billing_model==='MONTHLY'?"por mes":p.billing_model==='ANNUAL'?"por año":"pago único · uso sin vencimiento"}</p>
    <p>Una caja incluida · adicional $ {formatCopPesos(p.additional_register_price_minor)} COP</p>
    <p>Soporte opcional $ {formatCopPesos(p.support_price_minor)} COP / {p.support_term_months===1?"mes":"12 meses"}</p>
    <small>Versión {p.version} · publicada {new Date(p.published_at).toLocaleString("es-CO")}</small>
    <p>Preproducción · impuestos pendientes · compra productiva deshabilitada.</p>
    {p.billing_model==='PERPETUAL'&&<p>Soporte renovable por separado. No incluye servicios externos, facturación ilimitada ni versiones mayores futuras.</p>}
  </article>)}</div>;
}
export function PublicLicenseOffers({load}:{load?:(signal:AbortSignal)=>Promise<PublicLicenseOffer[]>}){
  const [offers,setOffers]=useState<PublicLicenseOffer[]|null>(null),[error,setError]=useState<string|null>(null),[busy,setBusy]=useState(false);
  const [client]=useState(()=>!load&&window.location.protocol==='https:'?new PublicLicenseClient():null);
  const [revision,setRevision]=useState(0);
  useEffect(()=>{const controller=new AbortController();let pending=false;
    const refresh=async()=>{if(pending||controller.signal.aborted)return;pending=true;setBusy(true);
      try{const data=load?await load(controller.signal):client?await client.offers(controller.signal):null;
        if(!data)throw Error("Consulta de precios no disponible en este entorno.");if(!controller.signal.aborted){setOffers(data);setError(null);}}
      catch(e){if(!controller.signal.aborted){setOffers(null);setError(e instanceof Error?e.message:"Precios no disponibles.");}}
      finally{pending=false;if(!controller.signal.aborted)setBusy(false);}};
    const visible=()=>{if(document.visibilityState==='visible')void refresh();};void refresh();window.addEventListener("focus",visible);document.addEventListener("visibilitychange",visible);
    return ()=>{controller.abort();window.removeEventListener("focus",visible);document.removeEventListener("visibilitychange",visible);};
  },[client,load,revision]);
  return <section className="pos-admin-surface" data-testid="public-license-offers"><h2>Planes disponibles</h2>
    <p>Precios publicados por Central para preproducción. No constituyen una cotización con impuestos.</p>
    <button type="button" disabled={busy} onClick={()=>setRevision(v=>v+1)}>{busy?"Consultando Central…":"Actualizar precios"}</button>
    {error&&<p role="alert">{error}</p>}{offers&&<LicenseOfferCards offers={offers}/>}{offers?.length===0&&<p role="status">Central todavía no ha publicado planes.</p>}
  </section>;
}
