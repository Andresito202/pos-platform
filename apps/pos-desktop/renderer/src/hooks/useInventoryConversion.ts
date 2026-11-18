import { useCallback,useEffect,useRef,useState } from "react";
import {
  InventoryConversionRuleApproveResultSchema,
  InventoryConversionExecuteResultSchema,
} from "@pos-platform/contracts";
import type { z } from "zod";
import { callCommercial,newIdempotencyKey } from "../pos-service.js";
import { toScale6 } from "../scale6.js";

type Approved=z.infer<typeof InventoryConversionRuleApproveResultSchema>;
type Converted=z.infer<typeof InventoryConversionExecuteResultSchema>;
type Operation={
  message:"inventory.conversion.rule.approve"|"inventory.conversion.execute";
  payload:Record<string,unknown>;key:string;
};
export function useInventoryConversion(){
  const [busy,setBusy]=useState(false);
  const [pending,setPending]=useState(false);
  const [error,setError]=useState<string|null>(null);
  const [rule,setRule]=useState<Approved|null>(null);
  const [conversion,setConversion]=useState<Converted|null>(null);
  const operation=useRef<Operation|null>(null);
  const inFlight=useRef(false);
  const uncertain=useRef(false);
  useEffect(()=>{
    if(!pending)return;
    const beforeUnload=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue="";};
    window.addEventListener("beforeunload",beforeUnload);
    return ()=>window.removeEventListener("beforeunload",beforeUnload);
  },[pending]);
  const retryPending=useCallback(async()=>{
    const current=operation.current;
    if(!current||inFlight.current)return;
    inFlight.current=true;setBusy(true);setError(null);
    try{
      const response=await callCommercial<Approved|Converted>(current.message,current.payload,current.key);
      const parser=current.message==="inventory.conversion.rule.approve"?
        InventoryConversionRuleApproveResultSchema:InventoryConversionExecuteResultSchema;
      const parsed=parser.safeParse(response.result);
      if(!parsed.success||response.result_code!==parsed.data.outcome||
         !["SUCCEEDED","REJECTED"].includes(response.status)){
        uncertain.current=true;
        setError("Respuesta de conversión no verificable. Reintenta el mismo identificador.");
        return;
      }
      if(uncertain.current&&response.status==="REJECTED"&&
         !["IDEMPOTENCY_CONFLICT","CONFLICT"].includes(parsed.data.outcome)){
        setError("Resultado incierto tras desconexión. No registres otra conversión.");
        return;
      }
      if(current.message==="inventory.conversion.rule.approve")setRule(parsed.data as Approved);
      else setConversion(parsed.data as Converted);
      operation.current=null;setPending(false);uncertain.current=false;
      if(response.status==="REJECTED")setError(parsed.data.outcome);
    }catch{
      uncertain.current=true;
      setError("Canal no confirmado. Reintenta sin cambiar el lote, cantidad ni clave.");
    }finally{inFlight.current=false;setBusy(false);}
  },[]);
  const start=useCallback(async(message:Operation["message"],payload:Record<string,unknown>)=>{
    if(inFlight.current||operation.current)return;
    operation.current={message,payload,key:newIdempotencyKey()};
    uncertain.current=false;setPending(true);setError(null);
    if(message==="inventory.conversion.rule.approve")setRule(null);
    else setConversion(null);
    await retryPending();
  },[retryPending]);
  const approve=useCallback(async(input:{
    sourcePresentationId:string;targetPresentationId:string;numerator:string;
    denominator:string;version:number;
  })=>start("inventory.conversion.rule.approve",{
    source_presentation_id:input.sourcePresentationId,target_presentation_id:input.targetPresentationId,
    numerator:input.numerator,denominator:input.denominator,version:input.version,
  }),[start]);
  const convert=useCallback(async(input:{
    ruleId:string;sourceLotId:string;quantity:string;reasonCode:string;businessDate:string;
  })=>{
    const quantity=toScale6(input.quantity);
    if(quantity===null){setError("Cantidad inválida o fuera de escala 6");return;}
    await start("inventory.conversion.execute",{
      rule_id:input.ruleId,source_lot_id:input.sourceLotId,quantity,
      reason_code:input.reasonCode,business_date:input.businessDate,
    });
  },[start]);
  return {busy,pending,error,rule,conversion,approve,convert,retryPending};
}
