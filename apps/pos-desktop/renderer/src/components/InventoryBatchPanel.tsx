import {useCallback,useRef,useState} from "react";
import {InventoryBatchListResultSchema,InventoryBatchStatusResultSchema} from "@pos-platform/contracts";
import {callCommercial,newIdempotencyKey} from "../pos-service.js";

type Lot={
 id:string;batch_code:string;quantity_on_hand:string;
 status:"AVAILABLE"|"QUARANTINE"|"BLOCKED"|"RECALLED";
 manufacture_date:string|null;expiry_date:string|null;
 supplier_reference:string;receipt_document:string;
};
type BatchList={outcome:"FOUND"|"UNAUTHORIZED";tracked:boolean;batches:Lot[]};
type BatchStatus="AVAILABLE"|"QUARANTINE"|"BLOCKED"|"RECALLED";

/**
 * Existing Inventory panel only. Read and write requests are authorized by
 * the commercial service's current connection-bound signed SAS, not a React
 * role flag. A network-uncertain state update keeps its original idempotency
 * key and exact payload; the operator may only retry that same operation.
 */
export function InventoryBatchPanel({presentationId,canAdjust}:{
 readonly presentationId:string;readonly canAdjust:boolean;
}):React.JSX.Element{
 const [data,setData]=useState<BatchList|null>(null);
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState<string|null>(null);
 const [selected,setSelected]=useState("");
 const [nextStatus,setNextStatus]=useState<BatchStatus>("QUARANTINE");
 const [reason,setReason]=useState("QUALITY_REVIEW");
 const pending=useRef<{key:string;payload:{lot_id:string;status:BatchStatus;reason_code:string}}|null>(null);
 const locked=useRef(false);
 const load=useCallback(async()=>{
   if(locked.current||pending.current)return;
   locked.current=true;setBusy(true);setError(null);
   try{
     const response=await callCommercial<BatchList>("inventory.batch.list",{presentation_id:presentationId});
     const parsed=InventoryBatchListResultSchema.safeParse(response.result);
     if(response.status!=="SUCCEEDED"||!parsed.success||parsed.data.outcome!=="FOUND"){
       setData(null);setError("No se pudieron consultar los lotes autorizados");return;
     }
     setData(parsed.data);
   }catch{setError("Servicio de lotes no disponible");}
   finally{locked.current=false;setBusy(false);}
 },[presentationId]);
 const write=useCallback(async()=>{
   if(locked.current)return;
   const current=pending.current;
   if(!current)return;
   locked.current=true;setBusy(true);setError(null);
   try{
     const response=await callCommercial<{outcome:string}>("inventory.batch.status",current.payload,current.key);
     const parsed=InventoryBatchStatusResultSchema.safeParse(response.result);
     if(!parsed.success||response.result_code!==parsed.data.outcome){
       setError("Resultado no concluyente. Reintenta la misma operación sin cambiar los datos.");
       return;
     }
     pending.current=null;
     if(response.status!=="SUCCEEDED"||!["UPDATED","IDEMPOTENT"].includes(parsed.data.outcome)){
       setError("Cambio rechazado: "+parsed.data.outcome);return;
     }
     setData(null);setSelected("");
     setError("Estado registrado. Actualiza la consulta para verificar el saldo vendible.");
   }catch{setError("Sin respuesta del servicio. Reintenta exactamente la misma operación.");}
   finally{locked.current=false;setBusy(false);}
 },[]);
 return <section aria-label="Inventario por lotes" data-testid="inventory-batches">
   <h3>Lotes de esta presentación</h3>
   <button type="button" onClick={()=>void load()} disabled={busy||pending.current!==null}>Consultar lotes</button>
   {data&&!data.tracked&&<p>Esta presentación usa inventario histórico sin seguimiento por lotes.</p>}
   {data?.tracked&&data.batches.length===0&&<p>Seguimiento activo sin lotes recibidos.</p>}
   {data?.tracked&&<table>
     <thead><tr><th>Lote</th><th>Existencia</th><th>Vence</th><th>Estado</th><th>Proveedor / documento</th></tr></thead>
     <tbody>{data.batches.map(lot=><tr key={lot.id}>
       <td>{lot.batch_code}</td><td>{lot.quantity_on_hand}</td>
       <td>{lot.expiry_date??"No aplica"}</td><td>{lot.status}</td>
       <td>{lot.supplier_reference} / {lot.receipt_document}</td>
     </tr>)}</tbody>
   </table>}
   {canAdjust&&data?.tracked&&data.batches.length>0&&<fieldset disabled={busy||pending.current!==null}>
     <legend>Bloqueo o retiro de lote (permiso de ajuste)</legend>
     <label>Lote
       <select value={selected} onChange={e=>setSelected(e.target.value)}>
         <option value="">Selecciona lote</option>
         {data.batches.map(lot=><option key={lot.id} value={lot.id}>{lot.batch_code}</option>)}
       </select>
     </label>
     <label>Nuevo estado
       <select value={nextStatus} onChange={e=>setNextStatus(e.target.value as BatchStatus)}>
         <option value="QUARANTINE">Cuarentena</option>
         <option value="BLOCKED">Bloqueado</option>
         <option value="RECALLED">Retirado</option>
         <option value="AVAILABLE">Disponible tras revisión</option>
       </select>
     </label>
     <label>Motivo auditado
       <input value={reason} onChange={e=>setReason(e.target.value.toUpperCase())}/>
     </label>
     <button type="button" disabled={!selected||!/^([A-Z][A-Z0-9_]{1,63})$/.test(reason)}
       onClick={()=>{
         if(!selected)return;
         pending.current={key:newIdempotencyKey(),payload:{lot_id:selected,status:nextStatus,reason_code:reason}};
         void write();
       }}>Registrar estado</button>
   </fieldset>}
   {pending.current&&<button type="button" disabled={busy} onClick={()=>void write()}>
     Reintentar el mismo cambio pendiente
   </button>}
   {error&&<p role="status">{error}</p>}
 </section>;
}
