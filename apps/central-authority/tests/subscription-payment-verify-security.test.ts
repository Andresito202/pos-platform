import {describe,expect,it,vi} from "vitest";
import {uuidV7,SubscriptionBankManualConfirmRequestSchema,SubscriptionPaymentVerifyRequestSchema} from "@pos-platform/contracts";
import {subscriptionAmountToScale6} from "../src/subscription-quote-contracts.js";
import {createHttpSubscriptionFactusPayGateway} from "../src/subscription-factus-pay-http-gateway.js";
import {SubscriptionFactusPayGatewayError} from "../src/subscription-factus-pay-gateway.js";

describe("subscription payment verify security",()=>{
  it("rejects free-text confirmation payloads at the contract boundary",()=>{
    expect(()=>SubscriptionPaymentVerifyRequestSchema.parse({
      payment_id:uuidV7(),
      observation_reference:"MANUAL-TRANSFER-001",
      correlation_id:uuidV7(),
    })).toThrow();
  });

  it("rejects bank-manual confirmation without receiving-account attestation",()=>{
    expect(()=>SubscriptionBankManualConfirmRequestSchema.parse({
      payment_id:uuidV7(),
      bank_reference:"TRF-1",
      receiving_bank:"Bancolombia",
      amount_minor:1000,
      deposit_at:"2026-11-23T15:00:00.000Z",
      exception_reason:"Provider down",
      operator_account_observation:"Seen in receiving account",
      bank_account_verified:false,
      customer_receipt_insufficient_acknowledged:true,
      correlation_id:uuidV7(),
    })).toThrow();
  });

  it("keeps catalog COP minors aligned with Factus Pay scale-6 amounts",()=>{
    expect(subscriptionAmountToScale6(4_990_000,2)).toBe("49900.000000");
    expect(subscriptionAmountToScale6(100_000,2)).toBe("1000.000000");
    expect(()=>subscriptionAmountToScale6(0,2)).toThrow("SUBSCRIPTION_QUOTE_AMOUNT_INVALID");
  });

  it("GET path rejects amount mismatches from the provider",async()=>{
    const reference=uuidV7();
    const transport=vi.fn(async()=>new Response(JSON.stringify({
      status:"success",
      data:{
        reference_code:reference,
        status:"paid",
        amount:"1000.00",
        currency_code:"COP",
      },
    }),{status:200,headers:{"content-type":"application/json"}}));
    const gateway=createHttpSubscriptionFactusPayGateway({
      environment:"SANDBOX",
      resolveAccessToken:async()=>"token-for-test-0123456789abcdef",
      transport:transport as unknown as typeof fetch,
    });
    await expect(gateway.getCollection({
      referenceCode:reference,
      expectedAmountScale6:"49900.000000",
    })).rejects.toMatchObject({code:"FACTUS_PAY_AMOUNT_MISMATCH"} satisfies Partial<SubscriptionFactusPayGatewayError>);
  });

  it("opens a collection only when the provider returns the reserved reference and amount",async()=>{
    const reference=uuidV7();
    const qr="data:image/png;base64,aaaa";
    const transport=vi.fn(async(input:RequestInfo)=>{
      const url=String(input);
      if(url.endsWith(`/v1/collections/${encodeURIComponent(reference)}`)){
        return new Response("",{status:404});
      }
      return new Response(JSON.stringify({
        status:"success",
        data:{
          reference_code:reference,
          status:"ready",
          amount:"49900",
          currency_code:"COP",
          qr,
        },
      }),{status:201,headers:{"content-type":"application/json"}});
    });
    const gateway=createHttpSubscriptionFactusPayGateway({
      environment:"SANDBOX",
      resolveAccessToken:async()=>"token-for-test-0123456789abcdef",
      transport:transport as unknown as typeof fetch,
    });
    const opened=await gateway.recoverOrCreateCollection({
      referenceCode:reference,
      amountScale6:"49900.000000",
      expirationSeconds:3600,
    });
    expect(opened).toEqual({
      referenceCode:reference,
      amountScale6:"49900.000000",
      status:"ready",
      qr,
      currencyCode:"COP",
    });
  });

  it("does not invent a successful paid status when the provider answers pending",async()=>{
    const reference=uuidV7();
    const transport=vi.fn(async()=>new Response(JSON.stringify({
      status:"success",
      data:{
        reference_code:reference,
        status:"pending",
        amount:"49900",
        currency_code:"COP",
      },
    }),{status:200,headers:{"content-type":"application/json"}}));
    const gateway=createHttpSubscriptionFactusPayGateway({
      environment:"SANDBOX",
      resolveAccessToken:async()=>"token-for-test-0123456789abcdef",
      transport:transport as unknown as typeof fetch,
    });
    const detail=await gateway.getCollection({
      referenceCode:reference,
      expectedAmountScale6:"49900.000000",
    });
    expect(detail.status).toBe("pending");
    expect(detail.status).not.toBe("paid");
  });
});
