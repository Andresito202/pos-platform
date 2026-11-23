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
import {SubscriptionFactusPayGatewayError} from "../src/subscription-factus-pay-gateway.js";
import {SubscriptionQuoteContracts} from "../src/subscription-quote-contracts.js";

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
      const isolation=saveContinuity(privateDir,record);
      expect(isolation).toBe(process.platform==="win32"?"WINDOWS_ICACLS":"POSIX_MODE");
      const loaded=loadContinuity(privateDir);
      expect(loaded?.reference_code).toBe(record.reference_code);
      expect(loaded?.amount_scale6).toBe("150000.000000");
      expect(loaded?.currency_code).toBe("COP");
      expect(loaded?.expiration_seconds).toBe(86_400);

      const qr="data:image/png;base64,aGVsbG8=";
      const written=writePrivateQr(privateDir,qr);
      expect(written.written).toBe(true);
      expect(existsSync(join(privateDir,"collection-qr.png"))).toBe(true);

      const evidence=emptyEvidence({
        commit:"a".repeat(40),
        mode:"prepare",
        referenceSha256:sha256Hex(record.reference_code),
        amountSha256:sha256Hex(record.amount_scale6),
      });
      evidence.private_qr_channel="WRITTEN";
      expect(evidence.simulator_requires_camera).toBe(true);
      expect(evidence.simulator_image_import_supported).toBe(false);
      expect(evidence.ephemeral_lab_service_issue).toBe(false);
      expect(evidence.global_quote_end_to_end).toBe(false);
      assertEvidenceIsRedacted(evidence);
      expect(()=>assertEvidenceIsRedacted({...evidence,qr})).toThrow("PR130_EVIDENCE_CONTAINS_QR");
      expect(()=>assertEvidenceIsRedacted({...evidence,reference_code:record.reference_code}))
        .toThrow("PR130_EVIDENCE_CONTAINS_REFERENCE");
    }finally{
      rmSync(root,{recursive:true,force:true});
    }
  });

  it("classifies RECOVERED from authentic GET before any POST",async()=>{
    const reference=uuidV7();
    const amount="150000.000000";
    const qr="data:image/png;base64,qqqq";
    const get=vi.fn(async()=>({
      referenceCode:reference,amountScale6:amount,status:"ready",qr,currencyCode:"COP" as const,
    }));
    const recoverOrCreate=vi.fn(async()=>{throw new Error("MUST_NOT_POST_WHEN_GET_HITS");});
    const opened=await prepareOrRecoverCollection({
      gateway:{getCollection:get,recoverOrCreateCollection:recoverOrCreate},
      continuity:newContinuityRecord({referenceCode:reference,amountScale6:amount}),
    });
    expect(opened).toEqual({status:"ready",qr,recovered:true,created:false,outcome:"RECOVERED"});
    expect(recoverOrCreate).not.toHaveBeenCalled();
  });

  it("classifies CREATED only after GET NOT_FOUND then open",async()=>{
    const reference=uuidV7();
    const amount="150000.000000";
    const qr="data:image/png;base64,qqqq";
    let gets=0;
    const gateway={
      getCollection:vi.fn(async()=>{
        gets+=1;
        if(gets===1)throw new SubscriptionFactusPayGatewayError("FACTUS_PAY_COLLECTION_NOT_FOUND");
        return {referenceCode:reference,amountScale6:amount,status:"ready",qr,currencyCode:"COP" as const};
      }),
      recoverOrCreateCollection:vi.fn(async()=>({
        referenceCode:reference,amountScale6:amount,status:"ready",qr,currencyCode:"COP" as const,
      })),
    };
    const opened=await prepareOrRecoverCollection({
      gateway,
      continuity:newContinuityRecord({referenceCode:reference,amountScale6:amount}),
    });
    expect(opened.outcome).toBe("CREATED");
    expect(opened.created).toBe(true);
    expect(opened.recovered).toBe(false);
    expect(gateway.recoverOrCreateCollection).toHaveBeenCalledOnce();
  });

  it("never treats ready as paid and rejects amount mismatches",async()=>{
    const reference=uuidV7();
    const gateway={
      getCollection:vi.fn(async()=>({
        referenceCode:reference,amountScale6:"150000.000000",status:"ready",qr:null,currencyCode:"COP" as const,
      })),
      recoverOrCreateCollection:vi.fn(),
    };
    const polled=await pollCollection({
      gateway,
      continuity:newContinuityRecord({referenceCode:reference,amountScale6:"150000.000000"}),
    });
    expect(polled.paid).toBe(false);

    const mismatch={
      getCollection:vi.fn(async()=>{throw new SubscriptionFactusPayGatewayError("FACTUS_PAY_AMOUNT_MISMATCH");}),
      recoverOrCreateCollection:vi.fn(),
    };
    await expect(pollCollection({
      gateway:mismatch,
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

  it("refuses recoverCollection when Factus gateway is not provisioned",async()=>{
    const quotes=new SubscriptionQuoteContracts(
      {connect:vi.fn()} as never,
      [{policy_reference:"P",tax_policy_reference:"T",support_policy_reference:"S"}],
      null,
      {reauthenticationMs:60_000,lockTimeoutMs:2_000,statementTimeoutMs:10_000},
      null,
    );
    await expect(quotes.recoverCollection(uuidV7(),{
      payment_id:uuidV7(),correlation_id:uuidV7(),
    })).rejects.toThrow("SUBSCRIPTION_FACTUS_PAY_GATEWAY_REQUIRED");
  });

  it("keeps lab claim fields distinct from commercial end-to-end",()=>{
    const evidence=emptyEvidence({
      commit:"a".repeat(40),mode:"paid_fulfillment",
      referenceSha256:"b".repeat(64),amountSha256:"c".repeat(64),
    });
    evidence.provider_paid_observed=true;
    evidence.ephemeral_lab_service_issue=true;
    expect(evidence.global_quote_end_to_end).toBe(false);
    expect(evidence.license_allocated).toBe(false);
    expect(evidence.device_activated).toBe(false);
    expect(evidence.runtime_verified).toBe(false);
  });
});
