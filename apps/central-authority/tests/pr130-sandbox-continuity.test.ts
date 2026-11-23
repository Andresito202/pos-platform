import {mkdtempSync,rmSync,existsSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {describe,expect,it,vi} from "vitest";
import {SubscriptionFulfillmentProvisionSchema,uuidV7} from "@pos-platform/contracts";
import {
  assertEvidenceIsRedacted,
  emptyEvidence,
  loadContinuity,
  newContinuityRecord,
  pollCollection,
  prepareOrRecoverCollection,
  resolvePrivateOperatorDir,
  saveContinuity,
  sha256Hex,
  writePrivateQr,
  PR130_COLLECTION_EXPIRATION_SECONDS,
} from "../src/pr130-lab-collection-continuity.js";
import {SubscriptionLicenseFulfillment} from "../src/subscription-license-fulfillment.js";

describe("PR130 sandbox collection continuity",()=>{
  it("rejects private operator directories inside evidence or artifacts",()=>{
    const root=mkdtempSync(join(tmpdir(),"pr130-cont-"));
    try{
      expect(()=>resolvePrivateOperatorDir(join(root,"artifacts","x"),join(root,"evidence"),root))
        .toThrow("PR130_PRIVATE_OPERATOR_DIR_INSIDE_ARTIFACTS_FORBIDDEN");
      expect(()=>resolvePrivateOperatorDir(join(root,"evidence","private"),join(root,"evidence"),root))
        .toThrow("PR130_PRIVATE_OPERATOR_DIR_INSIDE_EVIDENCE_FORBIDDEN");
      expect(()=>resolvePrivateOperatorDir("relative/private",join(root,"evidence"),root))
        .toThrow("PR130_PRIVATE_OPERATOR_DIR_ABSOLUTE_REQUIRED");
      expect(resolvePrivateOperatorDir(join(root,"private"),join(root,"evidence"),root))
        .toBe(join(root,"private"));
    }finally{
      rmSync(root,{recursive:true,force:true});
    }
  });

  it("persists immutable reference/amount and writes QR only privately",()=>{
    const root=mkdtempSync(join(tmpdir(),"pr130-cont-"));
    const privateDir=join(root,"private");
    try{
      const record=newContinuityRecord({
        referenceCode:uuidV7(),
        amountScale6:"150000.000000",
        expirationSeconds:PR130_COLLECTION_EXPIRATION_SECONDS,
      });
      saveContinuity(privateDir,record);
      const loaded=loadContinuity(privateDir);
      expect(loaded?.reference_code).toBe(record.reference_code);
      expect(loaded?.amount_scale6).toBe("150000.000000");
      expect(loaded?.currency_code).toBe("COP");
      expect(loaded?.expiration_seconds).toBe(86_400);

      const qr="data:image/png;base64,aGVsbG8=";
      expect(writePrivateQr(privateDir,qr)).toBe(true);
      expect(existsSync(join(privateDir,"collection-qr.png"))).toBe(true);

      const evidence=emptyEvidence({
        commit:"a".repeat(40),
        mode:"prepare",
        referenceSha256:sha256Hex(record.reference_code),
        amountSha256:sha256Hex(record.amount_scale6),
      });
      evidence.private_qr_channel="WRITTEN";
      assertEvidenceIsRedacted(evidence);
      expect(()=>assertEvidenceIsRedacted({...evidence,qr})).toThrow("PR130_EVIDENCE_CONTAINS_QR");
      expect(()=>assertEvidenceIsRedacted({...evidence,reference_code:record.reference_code}))
        .toThrow("PR130_EVIDENCE_CONTAINS_REFERENCE");
    }finally{
      rmSync(root,{recursive:true,force:true});
    }
  });

  it("reuses the same reference on recover and never treats ready as paid",async()=>{
    const reference=uuidV7();
    const amount="150000.000000";
    const qr="data:image/png;base64,qqqq";
    const transport=vi.fn(async(input:RequestInfo,init?:RequestInit)=>{
      const url=String(input);
      if(init?.method==="GET"||!init?.method){
        if(url.includes("/v1/collections/")){
          return new Response(JSON.stringify({
            status:"success",
            data:{reference_code:reference,status:"ready",amount:"150000",currency_code:"COP",qr},
          }),{status:200});
        }
      }
      return new Response(JSON.stringify({
        status:"success",
        data:{reference_code:reference,status:"ready",amount:"150000",currency_code:"COP",qr},
      }),{status:201});
    });
    const {createHttpSubscriptionFactusPayGateway}=await import("../src/subscription-factus-pay-http-gateway.js");
    const gateway=createHttpSubscriptionFactusPayGateway({
      environment:"SANDBOX",
      resolveAccessToken:async()=>"token-for-test-0123456789abcdef",
      transport:transport as unknown as typeof fetch,
    });
    const continuity=newContinuityRecord({referenceCode:reference,amountScale6:amount});
    const opened=await prepareOrRecoverCollection({gateway,continuity});
    expect(opened.status).toBe("ready");
    const polled=await pollCollection({gateway,continuity});
    expect(polled.status).toBe("ready");
    expect(polled.paid).toBe(false);
  });

  it("rejects wrong-company amount mismatches on poll",async()=>{
    const reference=uuidV7();
    const {createHttpSubscriptionFactusPayGateway}=await import("../src/subscription-factus-pay-http-gateway.js");
    const gateway=createHttpSubscriptionFactusPayGateway({
      environment:"SANDBOX",
      resolveAccessToken:async()=>"token-for-test-0123456789abcdef",
      transport:async()=>new Response(JSON.stringify({
        status:"success",
        data:{reference_code:reference,status:"paid",amount:"1000.00",currency_code:"COP"},
      }),{status:200}) as never,
    });
    await expect(pollCollection({
      gateway,
      continuity:newContinuityRecord({referenceCode:reference,amountScale6:"150000.000000"}),
    })).rejects.toMatchObject({code:"FACTUS_PAY_AMOUNT_MISMATCH"});
  });

  it("exposes enqueuePendingProviderPoll without inventing paid confirmation",async()=>{
    const provision=SubscriptionFulfillmentProvisionSchema.parse({
      profile:"CAMACHO_SUBSCRIPTION_FULFILLMENT_V1",
      policy_reference:"TEST_POLICY",
      expected_database:"pos_central",
      migration_checksum:"b".repeat(64),
      lock_timeout_ms:2000,statement_timeout_ms:10000,claim_ttl_ms:30000,
      poll_interval_ms:1000,max_attempts:8,base_backoff_ms:500,max_backoff_ms:8000,
    });
    const paymentId=uuidV7();
    const quoteId=uuidV7();
    const tenantId=uuidV7();
    const companyId=uuidV7();
    const client={
      query:vi.fn(async(sql:string)=>{
        if(sql.includes("BEGIN")||sql.includes("COMMIT")||sql.includes("ROLLBACK")||sql.includes("set_config")||sql.includes("FOR SHARE")){
          return {rows:[{
            payment_status:"PENDING",attempt_status:"PENDING",provider_reference:uuidV7(),
            total_minor:15_000_000,currency_exponent:2,expires_at:new Date(Date.now()+60_000),
            quote_id:quoteId,tenant_id:tenantId,company_id:companyId,
          }],rowCount:1};
        }
        if(sql.includes("license_quotes")){
          return {rows:[{quote_id:quoteId,tenant_id:tenantId,company_id:companyId}],rowCount:1};
        }
        return {rows:[],rowCount:0};
      }),
      release:vi.fn(),
    };
    const pool={
      connect:vi.fn(async()=>client),
      query:vi.fn(async()=>({rows:[{quote_id:quoteId,tenant_id:tenantId,company_id:companyId}],rowCount:1})),
    };
    const fulfillment=new SubscriptionLicenseFulfillment(
      pool as never,
      provision,
      [{policy_reference:"TEST_POLICY",tax_policy_reference:"TEST_TAX",support_policy_reference:"TEST_SUPPORT"}],
    );
    const enqueue=vi.spyOn(fulfillment.queue,"enqueue").mockResolvedValue("INSERTED");
    await expect(fulfillment.enqueuePendingProviderPoll({
      paymentId,correlationId:uuidV7(),
    })).resolves.toBe("INSERTED");
    expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({
      paymentId,status:"PENDING",confirmationSource:"PENDING_WEBHOOK",
    }));
  });
});
