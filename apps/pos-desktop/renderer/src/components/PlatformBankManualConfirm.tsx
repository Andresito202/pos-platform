import {useEffect,useState} from "react";
import {formatCopPesos,uuidV7} from "@pos-platform/contracts";
import type {PlatformClient} from "../platform-client.js";

type PendingPayment=Awaited<ReturnType<PlatformClient["listPendingSubscriptionPayments"]>>[number];

/**
 * Exceptional GLOBAL bank confirmation when Factus Pay cannot confirm.
 * Requires operator attestation of a deposit verified in the receiving account.
 * A customer receipt alone is never enough.
 */
export function PlatformBankManualConfirm({client}:{client:PlatformClient}):React.JSX.Element{
  const [pending,setPending]=useState<PendingPayment[]>([]);
  const [paymentId,setPaymentId]=useState("");
  const [bankReference,setBankReference]=useState("");
  const [receivingBank,setReceivingBank]=useState("");
  const [amountMinor,setAmountMinor]=useState("");
  const [depositAt,setDepositAt]=useState("");
  const [exceptionReason,setExceptionReason]=useState("");
  const [observation,setObservation]=useState("");
  const [bankVerified,setBankVerified]=useState(false);
  const [receiptInsufficient,setReceiptInsufficient]=useState(false);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState<string|null>(null);
  const [result,setResult]=useState<Awaited<ReturnType<PlatformClient["confirmBankManualSubscriptionPayment"]>>|null>(null);
  const selected=pending.find(row=>row.paymentId===paymentId)??null;

  async function refresh(){
    setBusy(true);setError(null);
    try{
      const rows=await client.listPendingSubscriptionPayments();
      setPending(rows);
      if(paymentId&&!rows.some(row=>row.paymentId===paymentId))setPaymentId("");
    }catch(failure){
      setError(failure instanceof Error?failure.message:"No se pudieron cargar las cotizaciones pendientes.");
    }finally{setBusy(false);}
  }

  useEffect(()=>{void refresh();},[]);

  useEffect(()=>{
    if(selected)setAmountMinor(String(selected.totalMinor));
  },[selected?.paymentId,selected?.totalMinor]);

  async function confirm(){
    if(busy||!selected)return;
    if(!bankVerified||!receiptInsufficient){
      setError("Debes confirmar la verificación directa en cuenta y que el comprobante del cliente no basta.");
      return;
    }
    const amount=Number.parseInt(amountMinor,10);
    if(!Number.isSafeInteger(amount)||amount<=0){setError("Indica el importe exacto de la cotización en minor units.");return;}
    const deposited=new Date(depositAt);
    if(!Number.isFinite(deposited.getTime())){setError("Indica la fecha y hora del abono bancario.");return;}
    setBusy(true);setError(null);setResult(null);
    try{
      setResult(await client.confirmBankManualSubscriptionPayment({
        payment_id:selected.paymentId,
        bank_reference:bankReference.trim(),
        receiving_bank:receivingBank.trim(),
        amount_minor:amount,
        deposit_at:deposited.toISOString(),
        exception_reason:exceptionReason.trim(),
        operator_account_observation:observation.trim(),
        bank_account_verified:true as const,
        customer_receipt_insufficient_acknowledged:true as const,
        correlation_id:uuidV7(),
      }));
      await refresh();
    }catch(failure){
      setError(failure instanceof Error?failure.message:"No se confirmó la consignación bancaria.");
    }finally{setBusy(false);}
  }

  return <section className="pos-admin-surface" aria-label="Confirmación bancaria excepcional">
    <h3>Confirmación bancaria excepcional</h3>
    <p>Usa este camino sólo cuando Factus Pay no puede confirmar. Debes verificar el abono directamente en la cuenta receptora. Un comprobante enviado por el cliente no es verificación suficiente.</p>
    <button type="button" disabled={busy} onClick={()=>void refresh()}>Actualizar cotizaciones pendientes</button>
    <fieldset disabled={busy||result!==null} className="pos-form-grid">
      <legend>Cotización pendiente y evidencia bancaria</legend>
      <label className="pos-field">Cotización pendiente<select aria-label="Cotización pendiente" value={paymentId} onChange={e=>setPaymentId(e.target.value)}>
        <option value="">Seleccionar cotización</option>
        {pending.map(row=><option key={row.paymentId} value={row.paymentId}>
          Pago {row.paymentId.slice(0,8)} · $ {formatCopPesos(row.totalMinor)} · vence {new Date(row.expiresAt).toLocaleString("es-CO")}
        </option>)}
      </select></label>
      {selected&&<p role="status">Tenant {selected.tenantId} · empresa {selected.companyId} · plan v{selected.planVersion} · referencia proveedor {selected.providerReference}</p>}
      <label className="pos-field">Referencia bancaria<input aria-label="Referencia bancaria" value={bankReference} maxLength={128} onChange={e=>setBankReference(e.target.value)}/></label>
      <label className="pos-field">Banco receptor<input aria-label="Banco receptor" value={receivingBank} maxLength={128} onChange={e=>setReceivingBank(e.target.value)}/></label>
      <label className="pos-field">Importe (minor COP)<input aria-label="Importe minor COP" inputMode="numeric" value={amountMinor} onChange={e=>setAmountMinor(e.target.value)}/></label>
      <label className="pos-field">Fecha y hora del abono<input aria-label="Fecha y hora del abono" type="datetime-local" value={depositAt} onChange={e=>setDepositAt(e.target.value)}/></label>
      <label className="pos-field">Motivo de la excepción<textarea aria-label="Motivo de la excepción" value={exceptionReason} maxLength={512} rows={3} onChange={e=>setExceptionReason(e.target.value)}/></label>
      <label className="pos-field">Observación de la cuenta receptora<textarea aria-label="Observación de la cuenta receptora" value={observation} maxLength={1024} rows={3} onChange={e=>setObservation(e.target.value)} placeholder="Describe lo verificado en el extracto o banca en línea de la cuenta receptora."/></label>
      <label><input type="checkbox" checked={bankVerified} onChange={e=>setBankVerified(e.target.checked)}/>Confirmo que verifiqué el abono directamente en la cuenta bancaria receptora.</label>
      <label><input type="checkbox" checked={receiptInsufficient} onChange={e=>setReceiptInsufficient(e.target.checked)}/>Reconozco que un comprobante del cliente no es verificación suficiente por sí solo.</label>
      <button type="button" disabled={busy||!selected||!bankVerified||!receiptInsufficient} onClick={()=>void confirm()}>Confirmar consignación y emitir licencia</button>
    </fieldset>
    {result&&<p role="status">Pago {result.paymentId} confirmado por consignación bancaria ({result.source}). Licencia {result.licenseId} · contrato {result.contractStatus}. Activación del dispositivo: {result.activationStatus}.{result.licenseIdempotent?" Licencia recuperada por idempotencia.":""}</p>}
    {busy&&<p role="status">Procesando en Central…</p>}
    {error&&<p role="alert">{error}</p>}
  </section>;
}
