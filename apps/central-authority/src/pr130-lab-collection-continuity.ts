/**
 * PR #130 lab-only collection continuity helpers.
 * Keeps the original FACTUS Pay reference stable across prepare/poll retries,
 * writes QR only to a private operator directory, and never forges "paid".
 */
import {createHash,randomUUID} from "node:crypto";
import {
  chmodSync,existsSync,lstatSync,mkdirSync,readFileSync,writeFileSync,
} from "node:fs";
import {isAbsolute,join,resolve,sep} from "node:path";
import type {SubscriptionFactusPayGateway} from "./subscription-factus-pay-gateway.js";

export const PR130_DEFAULT_AMOUNT_SCALE6="150000.000000";
/** Official FACTUS default window (24h). Avoids the previous 900s lab expiry. */
export const PR130_COLLECTION_EXPIRATION_SECONDS=86_400;
export const PR130_SIMULATOR_URL="https://pay-api-sandbox.factus.com.co/simulator";
export const PR130_SIMULATOR_DOCS_URL="https://pay-developers.factus.com.co/sandbox/simulator/";

export type Pr130ContinuityRecord={
  readonly profile:"CAMACHO_PR130_COLLECTION_CONTINUITY_V1";
  readonly reference_code:string;
  readonly amount_scale6:string;
  readonly currency_code:"COP";
  readonly quote_id:string|null;
  readonly payment_id:string|null;
  readonly tenant_id:string|null;
  readonly company_id:string|null;
  readonly created_at:string;
  readonly expiration_seconds:number;
};

export type Pr130RedactedEvidence={
  commit:string;
  environment:string;
  gateway:string;
  mode:string;
  reference_sha256:string;
  amount_sha256:string;
  quote_id_sha256:string|null;
  payment_id_sha256:string|null;
  collection_created:boolean;
  collection_recovered:boolean;
  collection_status:string|null;
  get_status:string|null;
  reference_and_amount_match:boolean;
  private_qr_channel: "WRITTEN"|"UNAVAILABLE"|"NOT_REQUESTED";
  private_qr_owner_reachable:boolean;
  simulator_docs_url:string;
  simulator_url:string;
  provider_paid_observed:boolean;
  confirmation_source:string|null;
  payment_confirmed:boolean;
  license_issued:boolean;
  device_activated:boolean;
  runtime_verified:boolean;
  block:string|null;
};

export function sha256Hex(value:string):string{
  return createHash("sha256").update(value).digest("hex");
}

export function assertAuthorizedPr130Gate(input:{
  directory:string;
  sha:string;
  requireActions?:boolean;
}):void{
  if(input.requireActions!==false){
    if(process.env.GITHUB_ACTIONS!=="true"
      ||process.env.GITHUB_REF!=="refs/heads/cursor/commercial-license-global-c53a"
      ||process.env.CAMACHO_COMMERCIAL_RUNTIME_CERT!=="OWNER_AUTHORIZED_COMMERCIAL_RUNTIME_CERT"){
      throw Error("PR130_SANDBOX_GATE_UNAUTHORIZED");
    }
  }else if(process.env.CAMACHO_COMMERCIAL_RUNTIME_CERT!=="OWNER_AUTHORIZED_COMMERCIAL_RUNTIME_CERT"){
    throw Error("PR130_SANDBOX_GATE_UNAUTHORIZED");
  }
  if(!input.directory||!/^[a-f0-9]{40}$/.test(input.sha)){
    throw Error("PR130_SANDBOX_GATE_UNAUTHORIZED");
  }
}

/** Private operator dir must be absolute and outside public evidence/artifacts. */
export function resolvePrivateOperatorDir(
  requested:string|undefined,
  evidenceDir:string,
  workspace?:string,
):string|null{
  if(!requested||requested.trim()==="")return null;
  if(!isAbsolute(requested))throw Error("PR130_PRIVATE_OPERATOR_DIR_ABSOLUTE_REQUIRED");
  const privateDir=resolve(requested);
  const evidence=resolve(evidenceDir);
  if(privateDir===evidence||privateDir.startsWith(evidence+sep)){
    throw Error("PR130_PRIVATE_OPERATOR_DIR_INSIDE_EVIDENCE_FORBIDDEN");
  }
  if(workspace){
    const artifacts=resolve(workspace,"artifacts");
    if(privateDir===artifacts||privateDir.startsWith(artifacts+sep)){
      throw Error("PR130_PRIVATE_OPERATOR_DIR_INSIDE_ARTIFACTS_FORBIDDEN");
    }
  }
  return privateDir;
}

export function ensurePrivateOperatorDir(privateDir:string):void{
  mkdirSync(privateDir,{recursive:true,mode:0o700});
  const st=lstatSync(privateDir);
  if(!st.isDirectory()||st.isSymbolicLink())throw Error("PR130_PRIVATE_OPERATOR_DIR_REJECTED");
  if(process.platform!=="win32")chmodSync(privateDir,0o700);
}

export function continuityPath(privateDir:string):string{
  return join(privateDir,"collection-continuity.json");
}

export function qrPath(privateDir:string):string{
  return join(privateDir,"collection-qr.png");
}

export function loadContinuity(privateDir:string):Pr130ContinuityRecord|null{
  const path=continuityPath(privateDir);
  if(!existsSync(path))return null;
  const st=lstatSync(path);
  if(!st.isFile()||st.isSymbolicLink()||st.size>16_384)throw Error("PR130_CONTINUITY_FILE_REJECTED");
  const parsed=JSON.parse(readFileSync(path,"utf8")) as Pr130ContinuityRecord;
  if(parsed.profile!=="CAMACHO_PR130_COLLECTION_CONTINUITY_V1")throw Error("PR130_CONTINUITY_PROFILE_REJECTED");
  if(!/^[0-9a-f-]{36}$/i.test(parsed.reference_code))throw Error("PR130_CONTINUITY_REFERENCE_INVALID");
  if(!/^(?:0|[1-9]\d{0,14})\.\d{6}$/.test(parsed.amount_scale6))throw Error("PR130_CONTINUITY_AMOUNT_INVALID");
  if(parsed.currency_code!=="COP")throw Error("PR130_CONTINUITY_CURRENCY_INVALID");
  return parsed;
}

export function saveContinuity(privateDir:string,record:Pr130ContinuityRecord):void{
  ensurePrivateOperatorDir(privateDir);
  const path=continuityPath(privateDir);
  writeFileSync(path,JSON.stringify(record,null,2)+"\n",{mode:0o600});
  if(process.platform!=="win32")chmodSync(path,0o600);
}

export function writePrivateQr(privateDir:string,qrDataUrl:string|null):boolean{
  if(qrDataUrl===null)return false;
  const match=/^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/.exec(qrDataUrl);
  if(!match)throw Error("PR130_PRIVATE_QR_REJECTED");
  ensurePrivateOperatorDir(privateDir);
  const path=qrPath(privateDir);
  writeFileSync(path,Buffer.from(match[1]!,"base64"),{mode:0o600});
  if(process.platform!=="win32")chmodSync(path,0o600);
  return true;
}

export function newContinuityRecord(input:{
  referenceCode?:string;
  amountScale6?:string;
  quoteId?:string|null;
  paymentId?:string|null;
  tenantId?:string|null;
  companyId?:string|null;
  expirationSeconds?:number;
}):Pr130ContinuityRecord{
  const reference=input.referenceCode??randomUUID();
  if(!/^[0-9a-f-]{36}$/i.test(reference))throw Error("PR130_CONTINUITY_REFERENCE_INVALID");
  return {
    profile:"CAMACHO_PR130_COLLECTION_CONTINUITY_V1",
    reference_code:reference.toLowerCase(),
    amount_scale6:input.amountScale6??PR130_DEFAULT_AMOUNT_SCALE6,
    currency_code:"COP",
    quote_id:input.quoteId??null,
    payment_id:input.paymentId??null,
    tenant_id:input.tenantId??null,
    company_id:input.companyId??null,
    created_at:new Date().toISOString(),
    expiration_seconds:input.expirationSeconds??PR130_COLLECTION_EXPIRATION_SECONDS,
  };
}

export function continuityFromEnvSecrets():Pr130ContinuityRecord|null{
  const reference=process.env.PR130_SANDBOX_COLLECTION_REFERENCE??"";
  const amount=process.env.PR130_SANDBOX_COLLECTION_AMOUNT??"";
  if(!reference&&!amount)return null;
  if(!reference||!amount)throw Error("PR130_CONTINUITY_SECRET_PAIR_REQUIRED");
  return newContinuityRecord({
    referenceCode:reference,
    amountScale6:amount,
    quoteId:process.env.PR130_SANDBOX_QUOTE_ID||null,
    paymentId:process.env.PR130_SANDBOX_PAYMENT_ID||null,
    tenantId:process.env.PR130_SANDBOX_TENANT_ID||null,
    companyId:process.env.PR130_SANDBOX_COMPANY_ID||null,
  });
}

export function emptyEvidence(input:{
  commit:string;
  mode:string;
  referenceSha256:string;
  amountSha256:string;
  quoteIdSha256?:string|null;
  paymentIdSha256?:string|null;
}):Pr130RedactedEvidence{
  return {
    commit:input.commit,
    environment:"FACTUS_PAY_SANDBOX",
    gateway:"CENTRAL_OFFICIAL_HTTP",
    mode:input.mode,
    reference_sha256:input.referenceSha256,
    amount_sha256:input.amountSha256,
    quote_id_sha256:input.quoteIdSha256??null,
    payment_id_sha256:input.paymentIdSha256??null,
    collection_created:false,
    collection_recovered:false,
    collection_status:null,
    get_status:null,
    reference_and_amount_match:false,
    private_qr_channel:"NOT_REQUESTED",
    private_qr_owner_reachable:false,
    simulator_docs_url:PR130_SIMULATOR_DOCS_URL,
    simulator_url:PR130_SIMULATOR_URL,
    provider_paid_observed:false,
    confirmation_source:null,
    payment_confirmed:false,
    license_issued:false,
    device_activated:false,
    runtime_verified:false,
    block:"PROVIDER_PAID_NOT_OBSERVED",
  };
}

export async function prepareOrRecoverCollection(input:{
  gateway:SubscriptionFactusPayGateway;
  continuity:Pr130ContinuityRecord;
}):Promise<{
  status:string;
  qr:string|null;
  recovered:boolean;
  created:boolean;
}>{
  const before=await input.gateway.recoverOrCreateCollection({
    referenceCode:input.continuity.reference_code,
    amountScale6:input.continuity.amount_scale6,
    expirationSeconds:input.continuity.expiration_seconds,
  }).catch(async(error:unknown)=>{
    // recoverOrCreate already GETs first; surface mismatches as hard failures.
    throw error;
  });
  // Second GET proves the same reference remains addressable after open/recover.
  const after=await input.gateway.getCollection({
    referenceCode:input.continuity.reference_code,
    expectedAmountScale6:input.continuity.amount_scale6,
  });
  if(after.referenceCode!==input.continuity.reference_code
    ||after.amountScale6!==input.continuity.amount_scale6
    ||after.currencyCode!=="COP"){
    throw Error("PR130_SANDBOX_COLLECTION_MISMATCH");
  }
  const recovered=before.status===after.status&&before.qr===after.qr;
  return {
    status:after.status,
    qr:after.qr??before.qr,
    recovered:recovered&&before.status!=="paid"?true:before.status==="ready"||before.status==="pending",
    created:!recovered,
  };
}

export async function pollCollection(input:{
  gateway:SubscriptionFactusPayGateway;
  continuity:Pr130ContinuityRecord;
}):Promise<{status:string;paid:boolean}>{
  const observed=await input.gateway.getCollection({
    referenceCode:input.continuity.reference_code,
    expectedAmountScale6:input.continuity.amount_scale6,
  });
  if(observed.referenceCode!==input.continuity.reference_code
    ||observed.amountScale6!==input.continuity.amount_scale6
    ||observed.currencyCode!=="COP"){
    throw Error("PR130_SANDBOX_COLLECTION_MISMATCH");
  }
  // ready/pending/expired never count as paid — only authentic provider "paid".
  return {status:observed.status,paid:observed.status==="paid"};
}

export function assertEvidenceIsRedacted(evidence:unknown):void{
  const text=JSON.stringify(evidence);
  if(/data:image\/png;base64,/i.test(text))throw Error("PR130_EVIDENCE_CONTAINS_QR");
  if(/"reference_code"\s*:/i.test(text))throw Error("PR130_EVIDENCE_CONTAINS_REFERENCE");
  if(/Bearer\s+/i.test(text))throw Error("PR130_EVIDENCE_CONTAINS_TOKEN");
}
