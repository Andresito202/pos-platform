import {useEffect,useState} from "react";
import {MerchantNoticesGetResultSchema,type MerchantNoticesGetResult} from "@pos-platform/contracts";
import {callCommercial} from "../pos-service.js";

const money=(cop:number)=>new Intl.NumberFormat("es-CO",{
 style:"currency",currency:"COP",maximumFractionDigits:0,
}).format(cop);

function requestedCop(value:string):number|null{
 if(!/^[1-9][0-9]{0,8}\\.0{6}$/.test(value))return null;
 const parsed=Number(value);
 return Number.isSafeInteger(parsed)&&parsed<=100_000_000?parsed:null;
}

/** QR-002: company-wide SMS observations, never tied to a particular sale. */
export function MerchantPaymentNoticePanel({enabled,amount}:{
 readonly enabled:boolean;readonly amount:string;
}):React.JSX.Element|null{
 const [notices,setNotices]=useState<MerchantNoticesGetResult["notices"]>([]);
 const [available,setAvailable]=useState(false);
 useEffect(()=>{
  if(!enabled){setNotices([]);setAvailable(false);return;}
  let stopped=false,running=false;
  const poll=async()=>{
   if(running||stopped)return;
   running=true;
   try{
    const response=await callCommercial<MerchantNoticesGetResult>("payment.notice.get",{});
    const result=MerchantNoticesGetResultSchema.safeParse(response.result);
    if(stopped)return;
    if(response.status!=="SUCCEEDED"||!result.success||result.data.outcome!=="AVAILABLE"){
     setNotices([]);setAvailable(false);return;
    }
    setNotices(result.data.notices);
    setAvailable(true);
   }catch{
    if(!stopped){setNotices([]);setAvailable(false);}
   }finally{running=false;}
  };
  void poll();
  const timer=setInterval(()=>{if(!document.hidden)void poll();},5000);
  return()=>{stopped=true;clearInterval(timer);};
 },[enabled]);
 if(!enabled)return null;
 const requested=requestedCop(amount);
 return <aside aria-label="Avisos Nequi no verificados" data-testid="merchant-notice-feed">
  <h4>Alertas recientes del negocio</h4>
  <p>Observaciones SMS no verificadas. No están asociadas automáticamente a esta venta.</p>
  {!available&&<p role="status">No hay conexión verificada con los avisos. Comprueba el ingreso en el banco.</p>}
  {available&&notices.length===0&&<p>No hay avisos recientes de Nequi Negocios.</p>}
  {available&&notices.slice(0,5).map(notice=>{
   const reported=notice.reported_amount_cop;
   const payer=notice.payer_display??"pagador no identificado";
   const difference=reported===null||requested===null?null:reported-requested;
   const comparison=difference===null?"No es posible comparar los importes.":
     difference===0?"Importe igual al solicitado, pero NO demuestra pago de esta venta.":
     difference<0?"Importe inferior en "+money(-difference)+" (según SMS).":
     "Importe superior en "+money(difference)+" (según SMS).";
   return <article key={notice.id} data-testid="merchant-notice-item">
    <strong>{reported===null?"Aviso sin importe informado":
      money(reported)+" informados por SMS"} · {payer}</strong>
    <p>{comparison}</p>
    <small>{new Date(notice.received_at).toLocaleString("es-CO")} · SIN VERIFICAR EN EL BANCO</small>
   </article>;
  })}
  <p><strong>Los avisos no confirman ni completan ventas.</strong> Verifica el movimiento en Nequi.</p>
 </aside>;
}
