/**
 * PR #130 lab-only: after authentic FACTUS Pay "paid", seed an ephemeral quote
 * bound to the same reference and run SubscriptionLicenseFulfillment SERVICE issue.
 * Never forges paid. Never uploads QR/reference/credentials.
 */
import {createHash} from "node:crypto";
import {mkdirSync,mkdtempSync,rmSync,writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
import {Pool} from "pg";
import {uuidV7} from "../../packages/contracts/src/primitives.js";
import {prepareSubscriptionFactusPayGateway} from "../../apps/central-authority/src/subscription-factus-pay-gateway-runtime.js";
import {SubscriptionLicenseFulfillment} from "../../apps/central-authority/src/subscription-license-fulfillment.js";
import {commercialMigrationManifest} from "../target-migrations/src/postgres-commercial-runner.js";
import {
  assertAuthorizedPr130Gate,
  assertEvidenceIsRedacted,
  continuityFromEnvSecrets,
  loadContinuity,
  pollCollection,
  resolvePrivateOperatorDir,
  sha256Hex,
  type Pr130ContinuityRecord,
} from "../../apps/central-authority/src/pr130-lab-collection-continuity.js";

const POLICY="PR130_LAB_FULFILLMENT_POLICY";
const TAX="PR130_LAB_TAX_POLICY";
const SUPPORT="PR130_LAB_SUPPORT_POLICY";

function amountParts(scale6:string):{totalMinor:number;payable:string}{
  if(!/^(?:0|[1-9]\d{0,14})\.\d{6}$/.test(scale6))throw Error("PR130_LAB_AMOUNT_INVALID");
  const [whole,frac]=scale6.split(".");
  const totalMinor=Number(whole)*100+Number(frac!.slice(0,2));
  if(!Number.isSafeInteger(totalMinor)||totalMinor<100_000)throw Error("PR130_LAB_AMOUNT_BELOW_FACTUS_MINIMUM");
  return {totalMinor,payable:`${whole}.${frac!.slice(0,2)}`};
}

async function seedPendingQuote(admin:Pool,continuity:Pr130ContinuityRecord){
  const {totalMinor,payable}=amountParts(continuity.amount_scale6);
  const tenant=uuidV7(),company=uuidV7(),branch=uuidV7();
  const user=uuidV7(),session=uuidV7();
  const provider=uuidV7(),adapter=uuidV7(),integration=uuidV7(),plan=uuidV7();
  const quote=continuity.quote_id&&/^[0-9a-f-]{36}$/i.test(continuity.quote_id)?continuity.quote_id:uuidV7();
  const payment=continuity.payment_id&&/^[0-9a-f-]{36}$/i.test(continuity.payment_id)?continuity.payment_id:uuidV7();
  const group=uuidV7(),attempt=uuidV7(),correlation=uuidV7();
  const checksum="a".repeat(64);
  const now=new Date();
  const expires=new Date(now.getTime()+86_400_000);
  const serviceUntil=new Date(now.getTime()+30*86_400_000);
  const terms={
    policy_reference:POLICY,
    tax_policy_reference:TAX,
    support_policy_reference:SUPPORT,
    customer_verification_reference:"PR130_LAB_CUSTOMER_VERIFICATION",
    tax_mode:"INCLUDED" as const,
    tax_minor:0,
    currency_exponent:2,
    service_from:now.toISOString(),
    service_until:serviceUntil.toISOString(),
    support_until:serviceUntil.toISOString(),
    expires_at:expires.toISOString(),
  };
  const entitlements=[{
    capability_code:"CASH_REGISTER",enabled:true,limit_type:"FINITE",limit_value:"1",
  }];
  const pricing={
    offer:{deployment_mode:"HYBRID",policy_reference:POLICY},
    pricing:{deployment_mode:"HYBRID",subtotal_minor:totalMinor,currency_code:"COP"},
    selection:{additional_registers:0,support:"STANDARD"},
    deployment_mode:"HYBRID",
  };
  const quoteChecksum=createHash("sha256").update(JSON.stringify({
    quote,payment,ref:continuity.reference_code,amount:continuity.amount_scale6,
  })).digest("hex");

  await admin.query("INSERT INTO tenancy.tenants(id,name,status,created_at,updated_at) VALUES($1,'PR130 Lab','ACTIVE',now(),now())",[tenant]);
  await admin.query(
    "INSERT INTO organization.companies(id,tenant_id,trade_name,timezone,currency_code,status,created_at,updated_at) VALUES($1,$2,'PR130 Lab','America/Bogota','COP','ACTIVE',now(),now())",
    [company,tenant],
  );
  await admin.query(
    "INSERT INTO organization.branches(id,tenant_id,company_id,name,timezone,status,created_at,updated_at) VALUES($1,$2,$3,'PR130 Lab','America/Bogota','ACTIVE',now(),now())",
    [branch,tenant,company],
  );
  await admin.query(
    "INSERT INTO identity.users(id,email,email_normalized,full_name,status,created_at,updated_at) VALUES($1,'pr130-lab@example.invalid','pr130-lab@example.invalid','PR130 Lab','ACTIVE',now(),now())",
    [user],
  );
  await admin.query(
    "INSERT INTO identity.sessions(id,user_id,authenticated_at,expires_at,mfa_status,created_at) VALUES($1,$2,now(),now()+interval '2 hour','SATISFIED',now())",
    [session,user],
  );
  await admin.query(
    `INSERT INTO integrations.provider_registry(provider_id,provider_code,display_name,integration_class,status,created_at,updated_at)
     VALUES($1,'FACTUS_PAY','Factus Pay','OTHER_REVIEW_REQUIRED','ACTIVE',now(),now())
     ON CONFLICT (provider_code) DO NOTHING`,
    [provider],
  );
  const providerId=(await admin.query(
    "SELECT provider_id::text AS id FROM integrations.provider_registry WHERE provider_code='FACTUS_PAY'",
  )).rows[0]?.id as string;
  if(!providerId)throw Error("PR130_LAB_FACTUS_PROVIDER_MISSING");
  await admin.query(
    `INSERT INTO integrations.provider_adapter_versions(
       provider_adapter_version_id,provider_id,adapter_code,adapter_version,contract_version,
       implementation_status,verification_status,created_at
     ) VALUES($1,$2,'FACTUS_PAY_HTTP','1',1,'IMPLEMENTED','MOCK_TESTED',now())
     ON CONFLICT (provider_id,adapter_code,adapter_version) DO NOTHING`,
    [adapter,providerId],
  );
  const adapterId=(await admin.query(
    `SELECT provider_adapter_version_id::text AS id
     FROM integrations.provider_adapter_versions
     WHERE provider_id=$1 AND adapter_code='FACTUS_PAY_HTTP'
     ORDER BY created_at LIMIT 1`,
    [providerId],
  )).rows[0]?.id as string;
  if(!adapterId)throw Error("PR130_LAB_FACTUS_ADAPTER_MISSING");
  await admin.query(
    `INSERT INTO integrations.external_integrations(id,tenant_id,company_id,provider_id,provider_code_snapshot,provider_adapter_version_id,environment,status,configuration_version,created_at,updated_at)
     VALUES($1,$2,$3,$4,'FACTUS_PAY',$5,'TEST','CREATED',1,now(),now())`,
    [integration,tenant,company,providerId,adapterId],
  );
  await admin.query(
    `INSERT INTO licensing.plans(id,code,name,billing_model,deployment_mode,currency_code,price_minor,status,created_at,updated_at)
     VALUES($1,'PR130_LAB','PR130 Lab','MONTHLY','HYBRID','COP',$2,'DRAFT',now(),now())`,
    [plan,totalMinor],
  );
  await admin.query(
    `INSERT INTO subscriptions.license_quotes(
      id,tenant_id,company_id,merchant_tenant_id,merchant_company_id,integration_id,provider_reference,
      plan_id,plan_version,currency_code,total_minor,currency_exponent,included_registers,additional_registers,
      pricing_snapshot,terms_snapshot,entitlements_snapshot,idempotency_key,request_checksum,quote_checksum,
      created_by_user_id,created_by_session_id,created_at,expires_at
    ) VALUES(
      $1,$2,$3,$2,$3,$4,$5,$6,1,'COP',$7,2,1,0,$8::jsonb,$9::jsonb,$10::jsonb,$1::text,$11,$12,$13,$14,now(),$15::timestamptz
    )`,
    [
      quote,tenant,company,integration,continuity.reference_code,plan,totalMinor,
      JSON.stringify(pricing),JSON.stringify(terms),JSON.stringify(entitlements),
      checksum,quoteChecksum,user,session,expires.toISOString(),
    ],
  );
  await admin.query(
    `INSERT INTO payments.payment_groups(
      id,tenant_id,company_id,branch_id,collection_subject_type,collection_subject_id,currency_code,
      expected_payable_amount,idempotency_key,request_checksum,correlation_id,created_at
    ) VALUES($1,$2,$3,$4,'SUBSCRIPTION_QUOTE',$5,'COP',$6::numeric,$1::text,$7,$8,now())`,
    [group,tenant,company,branch,quote,payable,checksum,correlation],
  );
  await admin.query(
    `INSERT INTO payments.payments(
      id,tenant_id,company_id,branch_id,payment_group_id,payment_method,expected_amount,currency_code,status,
      authority_type,operator_actor_type,idempotency_key,request_checksum,correlation_id,created_at,server_recorded_at
    ) VALUES($1,$2,$3,$4,$5,'QR',$6::numeric,'COP','CREATED','EXTERNAL_PROVIDER_AUTHORITATIVE','SYSTEM',$1::text,$7,$8,now(),now())`,
    [payment,tenant,company,branch,group,payable,checksum,correlation],
  );
  await admin.query("UPDATE payments.payments SET status='PENDING',version=version+1,server_recorded_at=clock_timestamp() WHERE id=$1 AND status='CREATED'",[payment]);
  await admin.query(
    `INSERT INTO payments.payment_attempts(
      id,tenant_id,company_id,branch_id,payment_id,attempt_number,payment_method,provider_code,
      provider_reference_type,provider_reference,integration_id,amount,currency_code,status,authority_type,
      intent_reference,idempotency_key,request_checksum,correlation_id,initiated_at,server_recorded_at
    ) VALUES(
      $1,$2,$3,$4,$5,1,'QR','FACTUS_PAY','COLLECTION',$6,$7,$8::numeric,'COP','CREATED',
      'EXTERNAL_PROVIDER_AUTHORITATIVE',$9,$1::text,$10,$11,now(),now()
    )`,
    [
      attempt,tenant,company,branch,payment,continuity.reference_code,integration,payable,
      `SUBSCRIPTION_QUOTE:${quote}`,checksum,correlation,
    ],
  );
  await admin.query(
    "UPDATE payments.payment_attempts SET status='PENDING',version=version+1,server_recorded_at=clock_timestamp() WHERE id=$1 AND status='CREATED'",
    [attempt],
  );

  return {tenant,company,quote,payment,correlation,quoteChecksum};
}

async function main():Promise<void>{
  const OUT="factus-paid-fulfillment.json";
  const directory=process.env.CAMACHO_CERT_EVIDENCE_DIR??"";
  const sha=process.env.REVIEWED_SHA??"";
  const email=process.env.FACTUS_PAY_SANDBOX_EMAIL??"";
  const password=process.env.FACTUS_PAY_SANDBOX_PASSWORD??"";
  const adminUrl=process.env.POSTGRES_ADMIN_URL??"";
  const appUrl=process.env.CENTRAL_DATABASE_URL??"";
  assertAuthorizedPr130Gate({directory,sha});
  if(!email||!password)throw Error("FACTUS_PAY_SANDBOX_CREDENTIALS_UNAVAILABLE");
  if(!adminUrl||!appUrl)throw Error("PR130_LAB_POSTGRES_REQUIRED");
  const adminParsed=new URL(adminUrl);
  if(adminParsed.hostname!=="127.0.0.1"||adminParsed.port!=="55438"
    ||process.env.GITHUB_ACTIONS!=="true"
    ||process.env.GITHUB_REF!=="refs/heads/cursor/commercial-license-global-c53a"){
    throw Error("PR130_LAB_EPHEMERAL_LOOPBACK_ONLY");
  }

  const privateDir=resolvePrivateOperatorDir(
    process.env.CAMACHO_PRIVATE_OPERATOR_DIR,
    directory,
    process.env.GITHUB_WORKSPACE??process.cwd(),
  );
  const continuity=continuityFromEnvSecrets()
    ??(privateDir?loadContinuity(privateDir):null)
    ??(process.env.RUNNER_TEMP
      ?loadContinuity(join(process.env.RUNNER_TEMP,"pr130-private-operator"))
      :null);
  if(!continuity)throw Error("PR130_CONTINUITY_REQUIRED_FOR_FULFILLMENT");

  const evidence:{
    commit:string;mode:string;reference_sha256:string;amount_sha256:string;
    provider_paid_observed:boolean;confirmation_source:string|null;
    payment_confirmed:boolean;license_issued:boolean;license_id_sha256:string|null;
    device_activated:boolean;runtime_verified:boolean;idempotent_reissue:boolean;
    block:string|null;
  }={
    commit:sha,mode:"paid_fulfillment",
    reference_sha256:sha256Hex(continuity.reference_code),
    amount_sha256:sha256Hex(continuity.amount_scale6),
    provider_paid_observed:false,confirmation_source:null,
    payment_confirmed:false,license_issued:false,license_id_sha256:null,
    device_activated:false,runtime_verified:false,idempotent_reissue:false,
    block:"PROVIDER_PAID_NOT_OBSERVED",
  };

  const sandbox=mkdtempSync(join(tmpdir(),"pr130-paid-fulfill-"));
  const admin=new Pool({connectionString:adminUrl,max:1});
  const app=new Pool({connectionString:appUrl,max:2});
  try{
    const credentialPath=join(sandbox,"credentials.json");
    const provisionPath=join(sandbox,"gateway.json");
    writeFileSync(credentialPath,JSON.stringify({email,password}),{mode:0o600});
    writeFileSync(provisionPath,JSON.stringify({
      profile:"CAMACHO_SUBSCRIPTION_FACTUS_PAY_GATEWAY_V1",
      policy_reference:"PR130_SANDBOX_ONLY",environment:"SANDBOX",
      credential_file:credentialPath,request_timeout_ms:20000,maximum_response_bytes:1048576,
    }),{mode:0o600});
    const gateway=prepareSubscriptionFactusPayGateway(provisionPath);
    const paid=await pollCollection({gateway,continuity});
    evidence.provider_paid_observed=paid.paid;
    if(!paid.paid){
      evidence.block="PROVIDER_PAID_NOT_OBSERVED";
      console.log("FACTUS_PAY_PROVIDER_PAID_OBSERVED=false");
      console.log("LICENSE_ISSUED=false");
      console.log("RUNTIME_VERIFIED=false");
      return;
    }

    const seeded=await seedPendingQuote(admin,continuity);
    const manifest=await commercialMigrationManifest("SUBSCRIPTION_FULFILLMENT");
    const checksum=manifest["035_subscription_license_fulfillment"];
    if(!checksum)throw Error("PR130_LAB_035_CHECKSUM_MISSING");
    const fulfillment=new SubscriptionLicenseFulfillment(
      app,
      {
        profile:"CAMACHO_SUBSCRIPTION_FULFILLMENT_V1",
        policy_reference:POLICY,
        expected_database:"postgres",
        migration_checksum:checksum,
        lock_timeout_ms:5_000,
        statement_timeout_ms:20_000,
        claim_ttl_ms:30_000,
        poll_interval_ms:1_000,
        max_attempts:8,
        base_backoff_ms:500,
        max_backoff_ms:8_000,
      },
      [{policy_reference:POLICY,tax_policy_reference:TAX,support_policy_reference:SUPPORT}],
      gateway,
    );

    await fulfillment.enqueuePendingProviderPoll({
      paymentId:seeded.payment,
      correlationId:seeded.correlation,
    });
    // Confirm (PENDING → CONFIRMED) then issue (CONFIRMED → ISSUED).
    const first=await fulfillment.processDue(1);
    const second=await fulfillment.processDue(1);
    const third=await fulfillment.processDue(1); // idempotent / no-op
    const job=await fulfillment.queue.getByPaymentId(seeded.payment);
    evidence.confirmation_source=job?.confirmation_source??null;
    evidence.payment_confirmed=evidence.confirmation_source==="FACTUS_PAY_GET"
      ||evidence.confirmation_source==="FACTUS_PAY_WEBHOOK_INBOX"
      ||evidence.confirmation_source==="BANK_MANUAL_VERIFIED";
    // markIssuedPipeline advances to ACTIVATION_PENDING with license_id set.
    evidence.license_issued=typeof job?.license_id==="string"
      &&["ISSUED","DELIVERY_PENDING","ACTIVATION_PENDING"].includes(String(job?.status));
    evidence.license_id_sha256=job?.license_id?sha256Hex(job.license_id):null;
    evidence.idempotent_reissue=third.issued===0&&evidence.license_issued;
    evidence.device_activated=false;
    evidence.runtime_verified=false;
    evidence.block=evidence.license_issued
      ?"DEVICE_ACTIVATION_CHANNEL_NOT_AVAILABLE"
      :`FULFILLMENT_INCOMPLETE:status=${job?.status??"none"};errors=${[...first.errors,...second.errors].join(",")}`;

    console.log("FACTUS_PAY_PROVIDER_PAID_OBSERVED=true");
    console.log("PAYMENT_CONFIRMED="+evidence.payment_confirmed);
    console.log("LICENSE_ISSUED="+evidence.license_issued);
    console.log("DEVICE_ACTIVATED=false");
    console.log("RUNTIME_VERIFIED=false");
  }finally{
    await admin.end().catch(()=>undefined);
    await app.end().catch(()=>undefined);
    rmSync(sandbox,{force:true,recursive:true});
    mkdirSync(resolve(directory),{recursive:true});
    assertEvidenceIsRedacted(evidence);
    writeFileSync(join(directory,OUT),JSON.stringify(evidence,null,2)+"\n",{mode:0o600});
  }
}

main().catch((error:unknown)=>{
  console.error("PR130_LAB_PAID_FULFILLMENT_FAILED="+(
    error instanceof Error?error.message.slice(0,160):"UNEXPECTED_ERROR"
  ));
  process.exitCode=1;
});
