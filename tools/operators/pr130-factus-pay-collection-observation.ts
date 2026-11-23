/**
 * PR #130: observed FACTUS Pay sandbox collection using the real Central gateway.
 * Explicitly NOT a payment simulator and NOT end-to-end license certification.
 * No secrets, QR payloads, tokens or complete transaction refs enter artifacts.
 */
import {createHash} from "node:crypto";
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
import {uuidV7} from "../../packages/contracts/src/primitives.js";
import {prepareSubscriptionFactusPayGateway} from "../../apps/central-authority/src/subscription-factus-pay-gateway-runtime.js";

async function main():Promise<void>{
const OUT="factus-collection-observation.json";
const directory=process.env.CAMACHO_CERT_EVIDENCE_DIR??"";
const sha=process.env.REVIEWED_SHA??"";
const email=process.env.FACTUS_PAY_SANDBOX_EMAIL??"";
const password=process.env.FACTUS_PAY_SANDBOX_PASSWORD??"";
if(process.env.GITHUB_ACTIONS!=="true"
  ||process.env.GITHUB_REF!=="refs/heads/cursor/commercial-license-global-c53a"
  ||process.env.CAMACHO_COMMERCIAL_RUNTIME_CERT!=="OWNER_AUTHORIZED_COMMERCIAL_RUNTIME_CERT"
  ||!directory||!/^[a-f0-9]{40}$/.test(sha))throw Error("PR130_SANDBOX_GATE_UNAUTHORIZED");
if(!email||!password)throw Error("FACTUS_PAY_SANDBOX_CREDENTIALS_UNAVAILABLE");
const sandbox=mkdtempSync(join(tmpdir(),"pr130-factus-pay-"));
const reference=uuidV7();
const amount="150000.000000";
const evidence:{
  commit:string;environment:string;gateway:string;reference_sha256:string;
  collection_created:boolean;collection_status:string|null;get_status:string|null;
  reference_and_amount_match:boolean;provider_paid_observed:boolean;
  license_issued:boolean;device_activated:boolean;runtime_verified:boolean;
  block:string|null;
}={
  commit:sha,environment:"FACTUS_PAY_SANDBOX",gateway:"CENTRAL_OFFICIAL_HTTP",
  reference_sha256:createHash("sha256").update(reference).digest("hex"),
  collection_created:false,collection_status:null,get_status:null,
  reference_and_amount_match:false,provider_paid_observed:false,
  license_issued:false,device_activated:false,runtime_verified:false,
  block:"PROVIDER_PAID_NOT_OBSERVED",
};
try{
  const credentialPath=join(sandbox,"credentials.json");
  const provisionPath=join(sandbox,"gateway.json");
  writeFileSync(credentialPath,JSON.stringify({email,password}),{mode:0o600});
  writeFileSync(provisionPath,JSON.stringify({
    profile:"CAMACHO_SUBSCRIPTION_FACTUS_PAY_GATEWAY_V1",
    policy_reference:"PR130_SANDBOX_ONLY",environment:"SANDBOX",
    credential_file:credentialPath,request_timeout_ms:20000,maximum_response_bytes:1048576,
  }),{mode:0o600});
  const client=prepareSubscriptionFactusPayGateway(provisionPath);
  const created=await client.recoverOrCreateCollection({
    referenceCode:reference,amountScale6:amount,expirationSeconds:900,
  });
  evidence.collection_created=true;
  evidence.collection_status=created.status;
  const observed=await client.getCollection({
    referenceCode:reference,expectedAmountScale6:amount,
  });
  evidence.get_status=observed.status;
  evidence.reference_and_amount_match=observed.referenceCode===reference
    &&observed.amountScale6===amount&&observed.currencyCode==="COP";
  if(!evidence.reference_and_amount_match)throw Error("PR130_SANDBOX_COLLECTION_MISMATCH");
  evidence.provider_paid_observed=observed.status==="paid";
  evidence.block=evidence.provider_paid_observed?"CENTRAL_LICENSE_E2E_NOT_EXECUTED":"PROVIDER_PAID_NOT_OBSERVED";
  console.log("FACTUS_PAY_COLLECTION_OPEN_AND_GET_VERIFIED");
  console.log("FACTUS_PAY_PROVIDER_PAID_OBSERVED="+evidence.provider_paid_observed);
  console.log("LICENSE_ISSUED=false");
  console.log("RUNTIME_VERIFIED=false");
}catch(error){
  evidence.block=error instanceof Error&&"code" in error
    ?String((error as {code:unknown}).code)
    :"FACTUS_PAY_COLLECTION_OBSERVATION_FAILED";
  console.error("FACTUS_PAY_COLLECTION_OBSERVATION_FAILED="+evidence.block);
  throw error;
}finally{
  rmSync(sandbox,{force:true,recursive:true});
  mkdirSync(resolve(directory),{recursive:true});
  writeFileSync(join(directory,OUT),JSON.stringify(evidence,null,2)+"\n",{mode:0o600});
}

}

main().catch((error:unknown)=>{
  console.error("PR130_FACTUS_PAY_COLLECTION_GATE_FAILED="+(error instanceof Error&&"code" in error?String((error as {code:unknown}).code):"UNEXPECTED_ERROR"));
  process.exitCode=1;
});
