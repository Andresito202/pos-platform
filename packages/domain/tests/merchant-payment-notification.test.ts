import {describe,expect,it} from "vitest";
import {
  MerchantPaymentNoticeObservationSchema,
  UnverifiedMerchantPaymentNoticeSchema,
  projectUnverifiedMerchantNotice,
  appendUnverifiedMerchantNotice,
  compareUnverifiedNoticeToRequestedAmount,
  extractUnverifiedSmsDetails,
} from "../src/merchant-payment-notification.js";

const companyA={tenantId:"11111111-1111-4111-8111-111111111111",
  companyId:"33333333-3333-4333-8333-333333333333",
  installationId:"55555555-5555-4555-8555-555555555555"};
const companyB={...companyA,companyId:"44444444-4444-4444-8444-444444444444"};
const signal={source:"NEQUI_NEGOCIOS_SHARED_SMS",message_sha256:"a".repeat(64),
  observed_at:"2026-11-07T10:00:00Z",received_at:"2026-11-07T10:00:30Z",
  sender_label:"Notificacion no verificada"};
describe("QR-002 external business SMS is ALWAYS unverified",()=>{
 it("produces merchant-isolated, non-financial evidence from enrolled bridge context",()=>{
  const item=projectUnverifiedMerchantNotice(companyA,signal);
  expect(item.tenant_id).toBe(companyA.tenantId);
  expect(item.company_id).toBe(companyA.companyId);
  expect(item.status).toBe("UNVERIFIED");
  expect(item.bank_confirmed).toBe(false);
  expect(item.sale_confirmed).toBe(false);
  expect(item.requires_independent_reconciliation).toBe(true);
  expect("sale_id" in item).toBe(false);
  expect("payment_id" in item).toBe(false);
  expect("amount_cop" in item).toBe(false);
 });
 it("does not accept a claimed tenant, bank success or sale identifier from SMS input",()=>{
  for(const key of ["tenant_id","company_id","bank_confirmed","sale_confirmed","payment_id","sale_id"]){
   expect(()=>projectUnverifiedMerchantNotice(companyA,{...signal,[key]:key.includes("confirmed")?true:"forged"})).toThrow();
  }
  expect(UnverifiedMerchantPaymentNoticeSchema.safeParse({
   ...projectUnverifiedMerchantNotice(companyA,signal),bank_confirmed:true,
  }).success).toBe(false);
 });
 it("never treats personal P2P QR or other app notifications as Nequi Negocios shared SMS",()=>{
  for(const source of ["NEQUI_P2P","BREB_PERSONAL","BANK_WEBHOOK","NEQUI_APP_PUSH"]){
   expect(MerchantPaymentNoticeObservationSchema.safeParse({...signal,source}).success).toBe(false);
  }
 });
 it("deduplicates exactly repeated evidence but never merges companies",()=>{
  const first=projectUnverifiedMerchantNotice(companyA,signal);
  const second=projectUnverifiedMerchantNotice(companyB,signal);
  const once=appendUnverifiedMerchantNotice([],first);
  expect(appendUnverifiedMerchantNotice(once,first)).toHaveLength(1);
  const both=appendUnverifiedMerchantNotice(once,second);
  expect(both).toHaveLength(2);
  expect(both[1]?.company_id).toBe(companyB.companyId);
 });
 it("rejects same-hash conflicting content, forged source and future timestamps",()=>{
  const first=projectUnverifiedMerchantNotice(companyA,signal);
  expect(()=>appendUnverifiedMerchantNotice([first],{
   ...first,sender_label:"Tampered", 
  })).toThrow("QR002_NOTIFICATION_IDEMPOTENCY_CONFLICT");
  expect(()=>projectUnverifiedMerchantNotice(companyA,{
   ...signal,observed_at:"2026-11-07T11:00:00Z",
  })).toThrow();
  expect(()=>projectUnverifiedMerchantNotice({...companyA,companyId:"invalid"},signal)).toThrow();
 });
 it("compares SMS-REPORTED amount to requested price without pretending the amount is credited",()=>{
  const claimed=projectUnverifiedMerchantNotice(companyA,{
    ...signal,reported_amount_cop:4500,payer_display:"Juan Pérez",
  });
  expect(compareUnverifiedNoticeToRequestedAmount(5000,claimed)).toEqual({
   requested_amount_cop:5000,reported_amount_cop:4500,difference_cop:-500,
   comparison:"LESS",payer_display:"Juan Pérez",bank_confirmed:false,
  });
  expect(compareUnverifiedNoticeToRequestedAmount(4500,claimed).comparison).toBe("EQUAL");
  expect(compareUnverifiedNoticeToRequestedAmount(4000,claimed).comparison).toBe("MORE");
  // Equal SMS value is not bank proof and cannot close a sale.
  expect(claimed.sale_confirmed).toBe(false);
  expect(claimed.bank_confirmed).toBe(false);
 });
 it("never replaces missing SMS amount or payer with the amount requested at the register",()=>{
  const unknown=projectUnverifiedMerchantNotice(companyA,signal);
  expect(unknown.reported_amount_cop).toBeNull();
  expect(unknown.payer_display).toBeNull();
  expect(compareUnverifiedNoticeToRequestedAmount(4500,unknown)).toEqual({
   requested_amount_cop:4500,reported_amount_cop:null,difference_cop:null,
   comparison:"UNKNOWN",payer_display:null,bank_confirmed:false,
  });
 });
 it("rejects impossible or fabricated SMS values and payer data",()=>{
  for(const amount of [0,-1,3.25,100000001,Number.MAX_SAFE_INTEGER,"4500"]){
   expect(()=>projectUnverifiedMerchantNotice(companyA,{...signal,reported_amount_cop:amount})).toThrow();
  }
  for(const payer of ["","X","<script>","A".repeat(81),"3227506213"]){
   expect(()=>projectUnverifiedMerchantNotice(companyA,{...signal,payer_display:payer})).toThrow();
  }
 });

 it("extracts only SMS-declared COP amount and claimed name from a synthetic example",()=>{
  expect(extractUnverifiedSmsDetails("Nequi: recibiste $4.500 de Juan Pérez.")).toEqual({
   reported_amount_cop:4500,payer_display:"Juan Pérez",
  });
  expect(extractUnverifiedSmsDetails("Nequi: recibido COP 4500 de Ana Ruiz.")).toEqual({
   reported_amount_cop:4500,payer_display:"Ana Ruiz",
  });
 });
 it("does not invent the bank amount or payer when the SMS lacks details",()=>{
  expect(extractUnverifiedSmsDetails("Nequi: recibiste una transferencia.")).toEqual({
   reported_amount_cop:null,payer_display:null,
  });
  expect(extractUnverifiedSmsDetails("Nequi: pago solicitado $4500 a Juan Pérez.")).toEqual({
   reported_amount_cop:null,payer_display:null,
  });
 });
 it("never assumes a requested price is the paid value when SMS has multiple currencies",()=>{
  expect(extractUnverifiedSmsDetails("recibiste $4.500 y COP 5.000 de Juan Pérez.").reported_amount_cop).toBeNull();
  expect(extractUnverifiedSmsDetails("recibiste $4,500 de Juan Pérez.").reported_amount_cop).toBeNull();
  expect(extractUnverifiedSmsDetails("recibiste $4.500,50 de Juan Pérez.").reported_amount_cop).toBeNull();
 });
 it("masks claimed 10-digit payer number, never stores a whole personal phone",()=>{
  const record=extractUnverifiedSmsDetails("Nequi: recibiste $4500 de 3227506213.");
  expect(record.reported_amount_cop).toBe(4500);
  expect(record.payer_display).toBe("******6213");
 });

});
