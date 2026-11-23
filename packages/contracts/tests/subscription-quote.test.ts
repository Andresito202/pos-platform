import {expect,it} from "vitest";
import {
  GlobalAdministrationProvisionSchema,
  SubscriptionBankManualConfirmRequestSchema,
  SubscriptionPaymentConfirmRequestSchema,
  SubscriptionPaymentVerifyRequestSchema,
  SubscriptionQuoteRequestSchema,
  previewLicenseOffer,
  uuidV7,
} from "../src/index.js";
import {LicenseOfferV2Schema} from "../src/license-offer.js";

const offer=LicenseOfferV2Schema.parse({
  id:uuidV7(),code:"CAMACHO_MONTHLY",name:"Mensual",billing_model:"MONTHLY",deployment_mode:"HYBRID",
  currency_code:"COP",currency_exponent:2,price_minor:4_990_000,included_registers:1,
  additional_register_price_minor:1_990_000,support_price_minor:1_490_000,
  support_charge:"OPTIONAL_SAME_TERM",support_term_months:1,policy_reference:"OWNER_PREPRODUCTION_2026_10_28",
  profile:"CAMACHO_LICENSE_OFFER_V2",publication_scope:"PREPRODUCTION",
});

it("accepts quote requests without client-supplied prices or entitlements",()=>{
  const request=SubscriptionQuoteRequestSchema.parse({
    id:uuidV7(),tenant_id:uuidV7(),company_id:uuidV7(),plan_id:offer.id,plan_version:1,
    selection:{additional_registers:2,support:true},idempotency_key:"quote-1",correlation_id:uuidV7(),
  });
  expect(request.selection.additional_registers).toBe(2);
  expect(()=>SubscriptionQuoteRequestSchema.parse({...request,total_minor:1})).toThrow();
});

it("rejects free-text observation references on payment verify",()=>{
  const paymentId=uuidV7();
  const correlationId=uuidV7();
  const verify=SubscriptionPaymentVerifyRequestSchema.parse({
    payment_id:paymentId,correlation_id:correlationId,
  });
  expect(verify).toEqual({payment_id:paymentId,correlation_id:correlationId});
  expect(()=>SubscriptionPaymentVerifyRequestSchema.parse({
    payment_id:paymentId,observation_reference:"TRANSFER-BANCOLOMBIA-001",correlation_id:correlationId,
  })).toThrow();
  expect(()=>SubscriptionPaymentConfirmRequestSchema.parse({
    payment_id:paymentId,observation_reference:"FAKE-REF",correlation_id:correlationId,
  })).toThrow();
  expect(()=>SubscriptionPaymentVerifyRequestSchema.parse({
    payment_id:paymentId,correlation_id:correlationId,amount:"100.00",
  })).toThrow();
});

it("requires explicit bank-account attestation for exceptional manual confirmation",()=>{
  const base={
    payment_id:uuidV7(),
    bank_reference:"TRF-123",
    receiving_bank:"Bancolombia",
    amount_minor:4_990_000,
    deposit_at:"2026-11-23T15:00:00.000Z",
    exception_reason:"Factus Pay unavailable after retries",
    operator_account_observation:"Deposit matched in receiving account statement",
    bank_account_verified:true as const,
    customer_receipt_insufficient_acknowledged:true as const,
    correlation_id:uuidV7(),
  };
  expect(SubscriptionBankManualConfirmRequestSchema.parse(base).bank_account_verified).toBe(true);
  expect(()=>SubscriptionBankManualConfirmRequestSchema.parse({
    ...base,bank_account_verified:false,
  })).toThrow();
  expect(()=>SubscriptionBankManualConfirmRequestSchema.parse({
    ...base,customer_receipt_insufficient_acknowledged:false,
  })).toThrow();
  expect(()=>SubscriptionBankManualConfirmRequestSchema.parse({
    ...base,operator_account_observation:"short",
  })).toThrow();
});

it("prices quotes only from the published catalog selection",()=>{
  const preview=previewLicenseOffer(offer,{additional_registers:2,support:true},3);
  expect(preview.subtotal_minor).toBe(4_990_000+1_990_000*2+1_490_000);
  expect(preview.payment_status).toBe("NOT_REQUESTED");
  expect(preview.tax_status).toBe("NOT_CALCULATED");
});

it("accepts optional subscription collection binding on GLOBAL provision",()=>{
  const base={
    profile:"CAMACHO_GLOBAL_ADMINISTRATION_V1" as const,
    policy_reference:"TEST",expected_database:"pos_test",rp_id:"localhost",
    rejection_verifier_file:"/tmp/rejection.txt",migration_checksum:"a".repeat(64),
    limits:{
      challenge_ms:60_000,session_ms:3_600_000,mfa_age_ms:3_600_000,reauthentication_ms:3_600_000,
      browser_ms:3_600_000,idle_ms:1_800_000,sql_lock_ms:5_000,sql_statement_ms:20_000,
      maximum_body_bytes:65_536,maximum_pending_flows:32,request_window_ms:60_000,requests_per_window:120,
      maximum_buckets:1_024,login_window_ms:60_000,maximum_login_per_address:20,maximum_login_per_account:10,
    },
  };
  const withCollection=GlobalAdministrationProvisionSchema.parse({
    ...base,
    subscription_collection:{
      tenant_id:uuidV7(),company_id:uuidV7(),branch_id:uuidV7(),integration_id:uuidV7(),
    },
  });
  expect(withCollection.subscription_collection?.integration_id).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  );
});
