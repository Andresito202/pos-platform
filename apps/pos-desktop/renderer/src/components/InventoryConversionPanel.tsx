import { useEffect,useState } from "react";
import { useInventoryConversion } from "../hooks/useInventoryConversion.js";

export function InventoryConversionPanel({sourcePresentationId,canApprove,businessDate}:{
  sourcePresentationId:string;canApprove:boolean;businessDate:string;
}):React.JSX.Element{
  const conversion=useInventoryConversion();
  const [target,setTarget]=useState("");
  const [numerator,setNumerator]=useState("1");
  const [denominator,setDenominator]=useState("1");
  const [version,setVersion]=useState("1");
  const [ruleId,setRuleId]=useState("");
  const [lotId,setLotId]=useState("");
  const [quantity,setQuantity]=useState("");
  const [reason,setReason]=useState("PRESENTATION_CONVERSION");
  useEffect(()=>{
    if(conversion.rule?.rule_id)setRuleId(conversion.rule.rule_id);
  },[conversion.rule]);
  return <fieldset className="pos-form-grid" aria-label="Conversión de presentaciones">
    <legend>Convertir presentaciones (misma referencia comercial)</legend>
    <p>La equivalencia se aprueba antes de convertir. Los lotes de origen deben estar disponibles y vigentes.
       Nunca se duplica la existencia ni se redondean cantidades.</p>
    {conversion.pending&&<div role="status" data-testid="conversion-pending">
      Operación sin confirmación definitiva. Conserva esta pantalla; no envíes otra operación.
      <button type="button" onClick={()=>{void conversion.retryPending();}} disabled={conversion.busy}>
        Reintentar la misma operación
      </button>
    </div>}
    {canApprove&&<>
      <label>Presentación destino (UUID)
        <input data-testid="conversion-target" value={target} onChange={e=>setTarget(e.target.value)}
          disabled={conversion.busy||conversion.pending}/>
      </label>
      <label>Unidades destino por unidades origen: numerador
        <input data-testid="conversion-numerator" value={numerator} inputMode="numeric"
          onChange={e=>setNumerator(e.target.value)} disabled={conversion.busy||conversion.pending}/>
      </label>
      <label>Denominador de la equivalencia
        <input data-testid="conversion-denominator" value={denominator} inputMode="numeric"
          onChange={e=>setDenominator(e.target.value)} disabled={conversion.busy||conversion.pending}/>
      </label>
      <label>Versión de equivalencia
        <input data-testid="conversion-version" value={version} inputMode="numeric"
          onChange={e=>setVersion(e.target.value)} disabled={conversion.busy||conversion.pending}/>
      </label>
      <button type="button" data-testid="conversion-approve"
        disabled={conversion.busy||conversion.pending||!sourcePresentationId||!target||!numerator||!denominator||
          !Number.isSafeInteger(Number(version))||Number(version)<1}
        onClick={()=>{void conversion.approve({
          sourcePresentationId,targetPresentationId:target.trim(),numerator:numerator.trim(),
          denominator:denominator.trim(),version:Number(version),
        });}}>Aprobar equivalencia</button>
    </>}
    <label>Regla aprobada (UUID)
      <input data-testid="conversion-rule-id" value={ruleId} onChange={e=>setRuleId(e.target.value)}
        disabled={conversion.busy||conversion.pending}/>
    </label>
    <label>Lote origen (UUID)
      <input data-testid="conversion-source-lot" value={lotId} onChange={e=>setLotId(e.target.value)}
        disabled={conversion.busy||conversion.pending}/>
    </label>
    <label>Cantidad origen
      <input data-testid="conversion-source-quantity" value={quantity}
        onChange={e=>setQuantity(e.target.value)} disabled={conversion.busy||conversion.pending}/>
    </label>
    <label>Motivo
      <input data-testid="conversion-reason" value={reason} onChange={e=>setReason(e.target.value)}
        disabled={conversion.busy||conversion.pending}/>
    </label>
    <button type="button" data-testid="conversion-execute"
      disabled={conversion.busy||conversion.pending||!ruleId||!lotId||!quantity||!reason}
      onClick={()=>{void conversion.convert({
        ruleId:ruleId.trim(),sourceLotId:lotId.trim(),quantity:quantity.trim(),
        reasonCode:reason.trim(),businessDate,
      });}}>Convertir existencias</button>
    {conversion.rule&&<output data-testid="conversion-rule-result">
      {conversion.rule.outcome} {conversion.rule.rule_id??""}
    </output>}
    {conversion.conversion&&<output data-testid="conversion-result">
      {conversion.conversion.outcome} · {conversion.conversion.target_quantity??""} · lote {conversion.conversion.target_lot_id??""}
    </output>}
    {conversion.error&&<p role="alert" data-testid="conversion-error">{conversion.error}</p>}
  </fieldset>;
}
