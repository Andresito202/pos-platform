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
   {value?.destinations.map(item=><article key={item.kind} className="pos-payment-destination" data-testid={"destination-"+item.kind}>
     <h4>{item.label}</h4>
     {(item.kind==="NEQUI_BUSINESS_QR"||item.kind==="BREB_KEY")&&item.qr_png_base64
       ? <img src={"data:image/png;base64,"+item.qr_png_base64} alt="QR oficial del comercio"
           width={224} height={224} style={{maxWidth:"100%",height:"auto",imageRendering:"auto"}} />
        : item.kind==="NEQUI_BUSINESS_QR"||item.kind==="BREB_KEY"
       ? <p>El QR oficial no está disponible en esta caja. Solicita sincronización al administrador.</p>
       : null}
     <p>{item.kind==="NEQUI_NUMBER"?"Nequi":item.kind==="BREB_KEY"?"Llave Bre-B":"Llave vinculada al QR"}</p>
     <strong data-testid="merchant-destination-reference">{item.destination_reference}</strong>
     <p>Importe de esta venta: {amount}. No garantiza que el QR tenga el importe precargado.</p>
   </article>)}
   {value&&value.destinations.length===0&&<p>El administrador no ha publicado un destino de cobro.</p>}
   <p><strong>Estado del dinero: pendiente de verificación.</strong> No se confirma ninguna venta desde este panel.</p>
 </section>;
}
