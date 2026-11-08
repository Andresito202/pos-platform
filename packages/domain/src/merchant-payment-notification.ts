import * as z from "zod";

/**
 * QR-002 (phase 2): evidence from a merchant-owned, opt-in notification phone.
 *
 * This is NOT a banking API, a signed bank receipt or a payment instruction.
 * Nequi's shared business SMS applies to Nequi Negocios keys/QR only; the
 * personal P2P QR is NOT an eligible source of these business notifications.
 *
 * The receiving service MUST derive scope from the enrolled bridge identity,
 * never from SMS text or caller-provided tenant/company claims.
 */
const Uuid=z.string().uuid();
const Sha256=z.string().regex(/^[a-f0-9]{64}$/);
const IsoDate=z.iso.datetime({offset:true});
/** Amount asserted in an SMS, never a bank-verified settlement. */
const SmsReportedAmount=z.number().int().positive().safe().max(100_000_000);
const SmsPayer=z.string().min(2).max(80)
  .regex(/^[\p{L}\p{N} .'*+-]{2,80}$/u);


export const MerchantPaymentNoticeObservationSchema=z.strictObject({
  source:z.literal("NEQUI_NEGOCIOS_SHARED_SMS"),
  message_sha256:Sha256,
  observed_at:IsoDate,
  received_at:IsoDate,
  // A bank SMS can be delayed, incomplete, duplicated or spoofed.
  // Zero monetary data is needed for the safe intake contract.
  sender_label:z.string().min(1).max(64),
  text_preview:z.string().max(200).optional(),
  reported_amount_cop:SmsReportedAmount.nullable().default(null),
  payer_display:SmsPayer.nullable().default(null),
}).superRefine((notice,ctx)=>{
  const observed=Date.parse(notice.observed_at);
  const received=Date.parse(notice.received_at);
  if(observed>received+5*60_000)
    ctx.addIssue({code:"custom",path:["observed_at"],message:"notification timestamp is in the future"});
});

export const UnverifiedMerchantPaymentNoticeSchema=z.strictObject({
  tenant_id:Uuid,
  company_id:Uuid,
  source_installation_id:Uuid,
  source:z.literal("NEQUI_NEGOCIOS_SHARED_SMS"),
  message_sha256:Sha256,
  observed_at:IsoDate,
  received_at:IsoDate,
  sender_label:z.string().min(1).max(64),
  text_preview:z.string().max(200).optional(),
  reported_amount_cop:SmsReportedAmount.nullable().default(null),
  payer_display:SmsPayer.nullable().default(null),
  status:z.literal("UNVERIFIED"),
  bank_confirmed:z.literal(false),
  sale_confirmed:z.literal(false),
  requires_independent_reconciliation:z.literal(true),
});

export type MerchantPaymentNoticeObservation=z.infer<typeof MerchantPaymentNoticeObservationSchema>;
export type UnverifiedMerchantPaymentNotice=z.infer<typeof UnverifiedMerchantPaymentNoticeSchema>;

export interface VerifiedMerchantNotificationBridgeScope {
  readonly tenantId:string;
  readonly companyId:string;
  readonly installationId:string;
}

/**
 * Pure fail-closed projection: only an authenticated, enrolled company bridge
 * may supply the scope. Neither input nor output can contain a sale/payment ID,
 * a BANK_CONFIRMED state or an instruction to update a transaction ledger.
 */
export function projectUnverifiedMerchantNotice(
  authenticated:VerifiedMerchantNotificationBridgeScope,
  observation:unknown,
):UnverifiedMerchantPaymentNotice {
  const scope=z.strictObject({
    tenantId:Uuid,companyId:Uuid,installationId:Uuid,
  }).parse(authenticated);
  const notice=MerchantPaymentNoticeObservationSchema.parse(observation);
  return UnverifiedMerchantPaymentNoticeSchema.parse({
    tenant_id:scope.tenantId,company_id:scope.companyId,
    source_installation_id:scope.installationId,
    ...notice,
    status:"UNVERIFIED",bank_confirmed:false,sale_confirmed:false,
    requires_independent_reconciliation:true,
  });
}

/**
 * Normalizes only duplicate EXACT evidence. Distinct messages with an equal
 * amount cannot be collapsed into one payment; the bank transaction ID is not
 * available, so no amount-based matching or auto-confirmation is permitted.
 */
export function appendUnverifiedMerchantNotice(
  existing:readonly UnverifiedMerchantPaymentNotice[],
  candidate:UnverifiedMerchantPaymentNotice,
):readonly UnverifiedMerchantPaymentNotice[] {
  const verified=UnverifiedMerchantPaymentNoticeSchema.parse(candidate);
  const previous=existing.map(v=>UnverifiedMerchantPaymentNoticeSchema.parse(v));
  const same=previous.find(item=>
    item.tenant_id===verified.tenant_id &&
    item.company_id===verified.company_id &&
    item.source_installation_id===verified.source_installation_id &&
    item.message_sha256===verified.message_sha256);
  if(same) {
    if(JSON.stringify(same)!==JSON.stringify(verified))
      throw new Error("QR002_NOTIFICATION_IDEMPOTENCY_CONFLICT");
    return previous;
  }
  return [...previous,verified];
}

/** Comparing two reported numbers NEVER confirms receipt or links a sale. */
export function compareUnverifiedNoticeToRequestedAmount(
 requestedAmountCop:number,
 notice:Pick<UnverifiedMerchantPaymentNotice,"reported_amount_cop"|"payer_display">,
):{requested_amount_cop:number;reported_amount_cop:number|null;
  difference_cop:number|null;comparison:"UNKNOWN"|"EQUAL"|"LESS"|"MORE";
  payer_display:string|null;bank_confirmed:false}{
 const requested=SmsReportedAmount.parse(requestedAmountCop);
 const reported=SmsReportedAmount.nullable().parse(notice.reported_amount_cop);
 const payer=SmsPayer.nullable().parse(notice.payer_display);
 return {
  requested_amount_cop:requested,reported_amount_cop:reported,
  difference_cop:reported===null?null:reported-requested,
  comparison:reported===null?"UNKNOWN":reported===requested?"EQUAL":
    reported<requested?"LESS":"MORE",
  payer_display:payer,bank_confirmed:false,
 };
}
