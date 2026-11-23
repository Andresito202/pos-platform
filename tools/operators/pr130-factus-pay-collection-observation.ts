/**
 * PR #130: observed FACTUS Pay sandbox collection using the real Central gateway.
 * Modes:
 *   observe (default) — create/recover + GET; never forges paid; no public QR
 *   prepare — durable continuity + private QR channel for official simulator
 *   poll — GET the same reference after human simulator payment
 *
 * Official simulator (human): https://pay-api-sandbox.factus.com.co/simulator
 * Docs: https://pay-developers.factus.com.co/sandbox/simulator/
 */
import {mkdirSync,mkdtempSync,rmSync,writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
import {prepareSubscriptionFactusPayGateway} from "../../apps/central-authority/src/subscription-factus-pay-gateway-runtime.js";
import {
  assertAuthorizedPr130Gate,
  assertEvidenceIsRedacted,
  continuityFromEnvSecrets,
  emptyEvidence,
  loadContinuity,
  newContinuityRecord,
  pollCollection,
  prepareOrRecoverCollection,
  resolvePrivateOperatorDir,
  saveContinuity,
  sha256Hex,
  writePrivateQr,
} from "../../apps/central-authority/src/pr130-lab-collection-continuity.js";

async function main():Promise<void>{
  const OUT="factus-collection-observation.json";
  const directory=process.env.CAMACHO_CERT_EVIDENCE_DIR??"";
  const sha=process.env.REVIEWED_SHA??"";
  const email=process.env.FACTUS_PAY_SANDBOX_EMAIL??"";
  const password=process.env.FACTUS_PAY_SANDBOX_PASSWORD??"";
  const mode=(process.env.PR130_COLLECTION_MODE??"observe").toLowerCase();
  if(!["observe","prepare","poll"].includes(mode))throw Error("PR130_COLLECTION_MODE_INVALID");

  const localOperator=process.env.PR130_LOCAL_OPERATOR==="true";
  assertAuthorizedPr130Gate({directory,sha,requireActions:!localOperator});
  if(!email||!password)throw Error("FACTUS_PAY_SANDBOX_CREDENTIALS_UNAVAILABLE");

  const privateDir=resolvePrivateOperatorDir(
    process.env.CAMACHO_PRIVATE_OPERATOR_DIR,
    directory,
    process.env.GITHUB_WORKSPACE??process.cwd(),
  );

  const secretContinuity=continuityFromEnvSecrets();
  let continuity=secretContinuity
    ??(privateDir?loadContinuity(privateDir):null)
    ??null;
  if(mode==="poll"&&continuity===null){
    throw Error("PR130_CONTINUITY_REQUIRED_FOR_POLL");
  }
  if(continuity===null){
    continuity=newContinuityRecord({});
  }

  const evidence=emptyEvidence({
    commit:sha,
    mode,
    referenceSha256:sha256Hex(continuity.reference_code),
    amountSha256:sha256Hex(continuity.amount_scale6),
    quoteIdSha256:continuity.quote_id?sha256Hex(continuity.quote_id):null,
    paymentIdSha256:continuity.payment_id?sha256Hex(continuity.payment_id):null,
  });

  const sandbox=mkdtempSync(join(tmpdir(),"pr130-factus-pay-"));
  try{
    const credentialPath=join(sandbox,"credentials.json");
    const provisionPath=join(sandbox,"gateway.json");
    writeFileSync(credentialPath,JSON.stringify({email,password}),{mode:0o600});
    writeFileSync(provisionPath,JSON.stringify({
      profile:"CAMACHO_SUBSCRIPTION_FACTUS_PAY_GATEWAY_V1",
      policy_reference:"PR130_SANDBOX_ONLY",
      environment:"SANDBOX",
      credential_file:credentialPath,
      request_timeout_ms:20000,
      maximum_response_bytes:1048576,
    }),{mode:0o600});
    const client=prepareSubscriptionFactusPayGateway(provisionPath);

    if(mode==="poll"){
      const observed=await pollCollection({gateway:client,continuity});
      evidence.get_status=observed.status;
      evidence.reference_and_amount_match=true;
      evidence.collection_recovered=true;
      evidence.provider_paid_observed=observed.paid;
      evidence.block=observed.paid
        ?"CENTRAL_LICENSE_E2E_AWAITING_FULFILLMENT"
        :"PROVIDER_PAID_NOT_OBSERVED";
      console.log("FACTUS_PAY_COLLECTION_POLL_VERIFIED");
      console.log("FACTUS_PAY_PROVIDER_PAID_OBSERVED="+observed.paid);
      console.log("LICENSE_ISSUED=false");
      console.log("RUNTIME_VERIFIED=false");
      if(observed.paid){
        console.log("OWNER_NEXT=run_pr130_lab_paid_fulfillment_against_same_reference");
      }else{
        console.log("OWNER_ACTION_REQUIRED=pay_via_official_simulator_then_repoll");
        console.log("SIMULATOR_URL=https://pay-api-sandbox.factus.com.co/simulator");
      }
    }else{
      const opened=await prepareOrRecoverCollection({gateway:client,continuity});
      evidence.collection_outcome=opened.outcome;
      evidence.collection_created=opened.created;
      evidence.collection_recovered=opened.recovered;
      evidence.collection_status=opened.status;
      const observed=await pollCollection({gateway:client,continuity});
      evidence.get_status=observed.status;
      evidence.reference_and_amount_match=true;
      evidence.provider_paid_observed=observed.paid;
      evidence.ephemeral_lab_service_issue=false;
      evidence.global_quote_end_to_end=false;
      evidence.license_allocated=false;

      const ownerReachable=localOperator
        ||process.env.PR130_PRIVATE_QR_OWNER_REACHABLE==="true"
        ||Boolean(secretContinuity);
      evidence.private_qr_owner_reachable=ownerReachable;

      if(privateDir){
        evidence.private_fs_isolation=saveContinuity(privateDir,continuity);
        const qrWrite=writePrivateQr(privateDir,opened.qr);
        evidence.private_qr_channel=qrWrite.written?"WRITTEN":"UNAVAILABLE";
        if(qrWrite.written)evidence.private_fs_isolation=qrWrite.isolation;
        console.log("PRIVATE_QR_CHANNEL="+evidence.private_qr_channel);
        console.log("PRIVATE_FS_ISOLATION="+evidence.private_fs_isolation);
        console.log("PRIVATE_QR_OWNER_REACHABLE="+ownerReachable);
        console.log("SIMULATOR_REQUIRES_CAMERA=true");
        console.log("SIMULATOR_IMAGE_IMPORT_SUPPORTED=false");
        console.log("SIMULATOR_URL=https://pay-api-sandbox.factus.com.co/simulator");
        if(ownerReachable){
          console.log("OWNER_ACTION=display_qr_on_second_surface_then_scan_with_android_simulator_camera");
        }else{
          console.log("OWNER_ACTION=use_GLOBAL_HTTPS_portal_or_local_private_dir_then_second_device_for_simulator");
        }
      }else{
        evidence.private_qr_channel="UNAVAILABLE";
        console.log("PRIVATE_QR_CHANNEL=UNAVAILABLE");
        console.log("BLOCK_DETAIL=set_CAMACHO_PRIVATE_OPERATOR_DIR_absolute_outside_artifacts_for_owner_qr");
        console.log("SIMULATOR_DOCS=https://pay-developers.factus.com.co/sandbox/simulator/");
      }

      if(observed.paid){
        evidence.block="CENTRAL_LICENSE_E2E_AWAITING_FULFILLMENT";
      }else if(!ownerReachable&&evidence.private_qr_channel!=="WRITTEN"){
        evidence.block="PRIVATE_QR_CHANNEL_UNAVAILABLE";
      }else if(!ownerReachable){
        evidence.block="PRIVATE_QR_CHANNEL_OWNER_UNREACHABLE";
      }else{
        evidence.block="PROVIDER_PAID_NOT_OBSERVED";
      }

      // Persist continuity locally for prepare even when CI has no private dir,
      // using a non-uploaded runner temp path so retries in the same job keep the ref.
      if(mode==="prepare"&&!privateDir&&process.env.RUNNER_TEMP){
        const ephemeralPrivate=resolvePrivateOperatorDir(
          join(process.env.RUNNER_TEMP,"pr130-private-operator"),
          directory,
          process.env.GITHUB_WORKSPACE??process.cwd(),
        );
        if(ephemeralPrivate){
          saveContinuity(ephemeralPrivate,continuity);
          writePrivateQr(ephemeralPrivate,opened.qr);
          console.log("EPHEMERAL_JOB_PRIVATE_CONTINUITY=written_not_uploaded");
        }
      }

      console.log("FACTUS_PAY_COLLECTION_OUTCOME="+opened.outcome);
      console.log("FACTUS_PAY_COLLECTION_OPEN_AND_GET_VERIFIED");
      console.log("FACTUS_PAY_PROVIDER_PAID_OBSERVED="+evidence.provider_paid_observed);
      console.log("GLOBAL_QUOTE_END_TO_END=false");
      console.log("LICENSE_ISSUED=false");
      console.log("RUNTIME_VERIFIED=false");
    }

    assertEvidenceIsRedacted(evidence);
  }catch(error){
    evidence.block=error instanceof Error&&"code" in error
      ?String((error as {code:unknown}).code)
      :(error instanceof Error?error.message.slice(0,96):"FACTUS_PAY_COLLECTION_OBSERVATION_FAILED");
    console.error("FACTUS_PAY_COLLECTION_OBSERVATION_FAILED="+evidence.block);
    throw error;
  }finally{
    rmSync(sandbox,{force:true,recursive:true});
    mkdirSync(resolve(directory),{recursive:true});
    assertEvidenceIsRedacted(evidence);
    writeFileSync(join(directory,OUT),JSON.stringify(evidence,null,2)+"\n",{mode:0o600});
  }
}

main().catch((error:unknown)=>{
  console.error("PR130_FACTUS_PAY_COLLECTION_GATE_FAILED="+(
    error instanceof Error&&"code" in error
      ?String((error as {code:unknown}).code)
      :"UNEXPECTED_ERROR"
  ));
  process.exitCode=1;
});
