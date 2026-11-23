/**
 * PR #130 lab-only collection continuity helpers.
 * Keeps the original FACTUS Pay reference stable across prepare/poll retries,
 * writes QR only to a private operator directory, and never forges "paid".
 * Not imported by Central main/runtime production bootstrap.
 */
import {execFileSync} from "node:child_process";
import {createHash,randomUUID} from "node:crypto";
import {
  chmodSync,existsSync,lstatSync,mkdirSync,readFileSync,writeFileSync,
} from "node:fs";
import {isAbsolute,join,resolve,sep} from "node:path";
import type {SubscriptionFactusPayGateway} from "./subscription-factus-pay-gateway.js";
import {SubscriptionFactusPayGatewayError} from "./subscription-factus-pay-gateway.js";

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

export type Pr130CollectionOutcome="CREATED"|"RECOVERED"|"INDETERMINATE";

export type Pr130RedactedEvidence={
  commit:string;
  environment:string;
  gateway:string;
  mode:string;
  reference_sha256:string;
  amount_sha256:string;
  quote_id_sha256:string|null;
  payment_id_sha256:string|null;
  /** Authentic POST-vs-GET classification; never inferred from two identical GETs. */
  collection_outcome:Pr130CollectionOutcome;
  collection_created:boolean;
  collection_recovered:boolean;
  collection_status:string|null;
  get_status:string|null;
  reference_and_amount_match:boolean;
  private_qr_channel: "WRITTEN"|"UNAVAILABLE"|"NOT_REQUESTED";
  private_qr_owner_reachable:boolean;
  /** POSIX mode bits are not NTFS ACLs; see privateFsIsolation. */
  private_fs_isolation:"POSIX_MODE"|"WINDOWS_ICACLS"|"UNVERIFIED";
  simulator_docs_url:string;
  simulator_url:string;
  simulator_requires_camera:boolean;
  simulator_image_import_supported:boolean;
  provider_paid_observed:boolean;
  ephemeral_lab_service_issue:boolean;
  global_quote_end_to_end:boolean;
  confirmation_source:string|null;
  payment_confirmed:boolean;
  license_issued:boolean;
  license_allocated:boolean;
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

/**
 * Effective private isolation:
 * - Linux/macOS: chmod 0700/0600 (POSIX mode bits).
 * - Windows: chmod does NOT establish NTFS ACL isolation. We apply icacls
 *   inheritance removal + current-user grant. If icacls fails, we throw —
 *   never claim WRITTEN privacy without ACL evidence on Windows.
 */
export function hardenPrivateFilesystemPath(targetPath:string,kind:"dir"|"file"):"POSIX_MODE"|"WINDOWS_ICACLS"{
  if(process.platform==="win32"){
    const user=process.env.USERNAME??process.env.USER??"";
    if(!user||/[\\"\r\n]/.test(user))throw Error("PR130_PRIVATE_WINDOWS_USER_REQUIRED");
    try{
      execFileSync("icacls",[targetPath,"/inheritance:r"],{windowsHide:true,stdio:"pipe"});
      execFileSync("icacls",[targetPath,"/grant:r",`${user}:(F)`],{windowsHide:true,stdio:"pipe"});
    }catch{
      throw Error("PR130_PRIVATE_WINDOWS_ACL_REQUIRED");
    }
    return "WINDOWS_ICACLS";
  }
  chmodSync(targetPath,kind==="dir"?0o700:0o600);
  return "POSIX_MODE";
}

export function ensurePrivateOperatorDir(privateDir:string):"POSIX_MODE"|"WINDOWS_ICACLS"{
  mkdirSync(privateDir,{recursive:true,mode:0o700});
  const st=lstatSync(privateDir);
  if(!st.isDirectory()||st.isSymbolicLink())throw Error("PR130_PRIVATE_OPERATOR_DIR_REJECTED");
  return hardenPrivateFilesystemPath(privateDir,"dir");
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

export function saveContinuity(privateDir:string,record:Pr130ContinuityRecord):"POSIX_MODE"|"WINDOWS_ICACLS"{
  const isolation=ensurePrivateOperatorDir(privateDir);
  const path=continuityPath(privateDir);
  writeFileSync(path,JSON.stringify(record,null,2)+"\n",{mode:0o600});
  hardenPrivateFilesystemPath(path,"file");
  return isolation;
}

export function writePrivateQr(privateDir:string,qrDataUrl:string|null):{
  written:boolean;
  isolation:"POSIX_MODE"|"WINDOWS_ICACLS"|"UNVERIFIED";
}{
  if(qrDataUrl===null)return {written:false,isolation:"UNVERIFIED"};
  const match=/^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/.exec(qrDataUrl);
  if(!match)throw Error("PR130_PRIVATE_QR_REJECTED");
  const isolation=ensurePrivateOperatorDir(privateDir);
  const path=qrPath(privateDir);
  writeFileSync(path,Buffer.from(match[1]!,"base64"),{mode:0o600});
  hardenPrivateFilesystemPath(path,"file");
  return {written:true,isolation};
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
    collection_outcome:"INDETERMINATE",
    collection_created:false,
    collection_recovered:false,
    collection_status:null,
    get_status:null,
    reference_and_amount_match:false,
    private_qr_channel:"NOT_REQUESTED",
    private_qr_owner_reachable:false,
    private_fs_isolation:"UNVERIFIED",
    simulator_docs_url:PR130_SIMULATOR_DOCS_URL,
    simulator_url:PR130_SIMULATOR_URL,
    // Official FACTUS simulator UI exposes only camera scan (no image import).
    simulator_requires_camera:true,
    simulator_image_import_supported:false,
    provider_paid_observed:false,
    ephemeral_lab_service_issue:false,
    global_quote_end_to_end:false,
    confirmation_source:null,
    payment_confirmed:false,
    license_issued:false,
    license_allocated:false,
    device_activated:false,
    runtime_verified:false,
    block:"PROVIDER_PAID_NOT_OBSERVED",
  };
}

/**
 * Classify CREATED vs RECOVERED using an authoritative GET-before-open sequence.
 * Two identical GET responses alone never prove a prior POST.
 */
export async function prepareOrRecoverCollection(input:{
  gateway:SubscriptionFactusPayGateway;
  continuity:Pr130ContinuityRecord;
}):Promise<{
  status:string;
  qr:string|null;
  recovered:boolean;
  created:boolean;
  outcome:Pr130CollectionOutcome;
}>{
  try{
    const existing=await input.gateway.getCollection({
      referenceCode:input.continuity.reference_code,
      expectedAmountScale6:input.continuity.amount_scale6,
    });
    if(existing.referenceCode!==input.continuity.reference_code
      ||existing.amountScale6!==input.continuity.amount_scale6
      ||existing.currencyCode!=="COP"){
      throw Error("PR130_SANDBOX_COLLECTION_MISMATCH");
    }
    return {
      status:existing.status,
      qr:existing.qr,
      recovered:true,
      created:false,
      outcome:"RECOVERED",
    };
  }catch(error){
    if(!(error instanceof SubscriptionFactusPayGatewayError)
      ||error.code!=="FACTUS_PAY_COLLECTION_NOT_FOUND"){
      throw error;
    }
  }

  const opened=await input.gateway.recoverOrCreateCollection({
    referenceCode:input.continuity.reference_code,
    amountScale6:input.continuity.amount_scale6,
    expirationSeconds:input.continuity.expiration_seconds,
  });
  const after=await input.gateway.getCollection({
    referenceCode:input.continuity.reference_code,
    expectedAmountScale6:input.continuity.amount_scale6,
  });
  if(after.referenceCode!==input.continuity.reference_code
    ||after.amountScale6!==input.continuity.amount_scale6
    ||after.currencyCode!=="COP"
    ||opened.referenceCode!==after.referenceCode){
    throw Error("PR130_SANDBOX_COLLECTION_MISMATCH");
  }
  return {
    status:after.status,
    qr:after.qr??opened.qr,
    recovered:false,
    created:true,
    outcome:"CREATED",
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
