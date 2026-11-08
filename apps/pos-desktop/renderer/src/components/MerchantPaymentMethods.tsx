import {useCallback,useEffect,useState} from "react";
import {MerchantDestinationsGetResultSchema,type MerchantDestinationsGetResult} from "@pos-platform/contracts";
import {callCommercial} from "../pos-service.js";

/**
 * QR-001: cashier-only company destination, never a banking success signal.
 * Amount shown here is the POS amount, not embedded in the bank-issued QR.
 * The official PNG is delivered only inside a verified signed company snapshot.
 */
export function MerchantPaymentMethods({enabled,amount}:{
 readonly enabled:boolean;
 readonly amount:string;
}):React.JSX.Element|null {
 const [value,setValue]=useState<MerchantDestinationsGetResult|null>(null);
 const [loading,setLoading]=useState(false);
 const [error,setError]=useState<string|null>(null);
 const [selectedKind,setSelectedKind]=useState<string|null>(null);
 const selected=value?.destinations.find(item=>item.kind===selectedKind)??value?.destinations[0];
 const read=useCallback(async()=>{
   if(!enabled)return;
   setLoading(true);setError(null);
   try{
     const response=await callCommercial<MerchantDestinationsGetResult>("payment.destination.get",{});
     const parsed=MerchantDestinationsGetResultSchema.safeParse(response.result);
     if(response.status!=="SUCCEEDED"||!parsed.success||parsed.data.outcome!=="AVAILABLE"){
       setValue(null);
       setError("No hay una configuración vigente de cobro para esta empresa.");
       return;
     }
     setValue(parsed.data);
   }catch{
     setValue(null);
     setError("No se pudo verificar la configuración del comercio.");
   }finally{setLoading(false);}
 },[enabled]);
 useEffect(()=>{void read();},[read]);
 if(!enabled)return null;
 return <section className="pos-payment-destinations" aria-label="Cobro directo Nequi y Bre-B" data-testid="merchant-payment-methods">
   <h3>Nequi / Bre-B del negocio</h3>
   <p>El dinero se transfiere directamente al comercio. Verifica el abono antes de confirmar el pago.</p>
   <button type="button" disabled={loading} onClick={()=>{void read();}} data-testid="refresh-merchant-destinations">
     {loading?"Consultando…":"Actualizar datos del comercio"}
   </button>
   {error&&<p role="status" data-testid="merchant-payment-unavailable">{error}</p>}
   {value&&value.destinations.length>1&&<div role="group" aria-label="Elegir método de transferencia" className="pos-merchant-method-selector">
     {value.destinations.map(item=><button key={item.kind} type="button" onClick={()=>setSelectedKind(item.kind)}
       aria-pressed={selected?.kind===item.kind}
       data-testid={"choose-destination-"+item.kind}>
         {item.kind==="NEQUI_BUSINESS_QR"?"QR Nequi":item.kind==="BREB_KEY"?"Bre-B":"Número Nequi"}
     </button>)}
   </div>}
   {selected&&<article key={selected.kind} className="pos-payment-destination" data-testid={"destination-"+selected.kind}>
     <h4>{selected.label}</h4>
     {selected.qr_png_base64
       ? <img src={"data:image/png;base64,"+selected.qr_png_base64}
           alt="QR de cobro proporcionado por el comercio"
           width={320} height={320} style={{maxWidth:"100%",height:"auto",imageRendering:"auto",background:"#fff"}} />
       : selected.kind==="NEQUI_BUSINESS_QR"
       ? <p>El QR no está disponible en esta caja. Solicita sincronización al administrador.</p>
       : null}
     <p>{selected.kind==="NEQUI_NUMBER"?"Número Nequi":selected.kind==="BREB_KEY"?"Llave Bre-B":"Referencia del QR Nequi"}</p>
     <strong data-testid="merchant-destination-reference">{selected.destination_reference}</strong>
     <p>Importe de esta venta: {amount}. El QR original puede no incorporar el valor de la venta.</p>
   </article>}
   {value&&value.destinations.length===0&&<p>El administrador no ha publicado un destino de cobro.</p>}
   <p><strong>Estado del dinero: pendiente de verificación.</strong> No se confirma ninguna venta desde este panel.</p>
 </section>;
}
