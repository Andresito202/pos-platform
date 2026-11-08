import {lstatSync,readFileSync} from "node:fs";
import {isAbsolute,resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {createHash,createPrivateKey,createPublicKey,verify,type KeyObject} from "node:crypto";
import {CentralCommercialProvisionSchema,validateWindowsCommercialRegistration,validateCommercialHttpsOrigin,AuthorizationTrustDeliverySchema,
  SignedSessionAssertionOperationalKeySchema,SessionAssertionTrustBundleSchema,unsignedAuthorizationTrustBytes,unsignedSessionAssertionOperationalKeyBytes,
  canonicalSessionTrustJson,PlatformSecurityEventCode,uuidV7,isSupportedPlatformPasswordVerifier} from "@pos-platform/contracts";
import {PostgresCommercialDeploymentContext,PostgresCommercialRefreshFamilies,PostgresBrowserSessionHandoffWriter,PostgresPlatformSecurityEventRepository,type Pool} from "@pos-platform/database-postgres";
import {BusinessInitialMfaFlow} from "./business-initial-mfa-flow.js";
import {BusinessSessionAuthority} from "./business-session-authority.js";
import {BusinessAccessPreparation} from "./business-access-preparation.js";
import {DurableBrowserSessionStore} from "./durable-browser-session-store.js";
import {CommercialNativeClientCatalog} from "./commercial-native-client-catalog.js";
import {CommercialBusinessAccessAuthority} from "./isolated-business-access-token-codec.js";
import {IsolatedBusinessCredentialPairIssuer} from "./isolated-business-credential-pair-issuer.js";
import {IsolatedBusinessAuthCoordinator} from "./isolated-business-auth-coordinator.js";
import {IsolatedBusinessAuditSessionGuard} from "./isolated-business-audit-session-guard.js";
import {IsolatedNativeBusinessRequests} from "./isolated-native-business-requests.js";
import {IsolatedAuthorizationSnapshotIssuer} from "./isolated-authorization-snapshot-issuer.js";
import {prepareCommercialHttpHandler} from "./isolated-commercial-https.js";
import {MerchantBusinessDestinationOperations} from "./merchant-destination-business-operations.js";
import {CentralMerchantDestinationPublisher} from "./merchant-destination-snapshot-publisher.js";
import {MerchantDestinationDeviceRoutes} from "./merchant-destination-device-routes.js";

function managed(path:string,max=1048576){
  if(!isAbsolute(path))throw Error("COMMERCIAL_MANAGED_ABSOLUTE_FILE_REQUIRED");
  const s=lstatSync(path);if(!s.isFile()||s.isSymbolicLink()||s.size>max)throw Error("COMMERCIAL_MANAGED_FILE_REJECTED");
  return readFileSync(path);
}
const json=(path:string)=>JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(managed(path)));
function root(path:string,pin:string){
  const key=createPublicKey(managed(path,4096));
  if(key.asymmetricKeyType!=="ed25519"||createHash("sha256").update(key.export({type:"spki",format:"der"})).digest("hex")!==pin)throw Error("COMMERCIAL_ROOT_PIN_REJECTED");return key;
}
const publicMaterial=(key:KeyObject)=>key.export({type:"spki",format:"der"}).toString("hex");

/** One composition on the existing Central listener. No constructor accepts
 * client-supplied approval flags, identities or a synthetic authenticated user. */
export async function prepareCentralCommercialRuntime(input:{pool:Pool;provisionFile:string;origin:string;environment:"PREPRODUCTION"|"PRODUCTION";
  tls:{key:Buffer;cert:Buffer};publishedSsaFile:string;publishedSasFile:string;merchantDestinationsEnabled?:boolean;
  merchantQrSigning?:{keyPath:string;keyId:string;validFrom:string;validUntil:string}}){
  const p=CentralCommercialProvisionSchema.parse(json(input.provisionFile)),l=p.limits,d=p.recipient;
  validateCommercialHttpsOrigin(input.origin);validateWindowsCommercialRegistration(p.registration,p.rp_id,input.origin);
  if(p.environment!==input.environment||p.registration.authorizationOrigin!==input.origin||resolve(p.sas.trust_bundle_file)!==resolve(input.publishedSasFile))throw Error("COMMERCIAL_DEPLOYMENT_SCOPE_REJECTED");
  const deployment=await PostgresCommercialDeploymentContext.verify(input.pool,{expectedDatabase:p.expected_database,checksums:p.schema_checksums});
  const ssaRoot=root(p.ssa.root_public_key_file,p.ssa.root_spki_sha256),ssa=SignedSessionAssertionOperationalKeySchema.parse(json(p.ssa.operational_key_file));
  const ssaPrivate=createPrivateKey(managed(p.ssa.private_key_file,8192)),ssaPublic=createPublicKey(ssaPrivate),now=Date.now();
  if(ssa.claims.environment!==p.environment||ssa.claims.status!=="ACTIVE"||ssa.claims.key_purpose!=="SESSION_ASSERTION"||Date.parse(ssa.claims.valid_from)>now||
    ssa.claims.valid_until!==null&&Date.parse(ssa.claims.valid_until)<=now||!verify(null,unsignedSessionAssertionOperationalKeyBytes(ssa.claims),ssaRoot,Buffer.from(ssa.signature,"base64url"))||
    publicMaterial(ssaPublic)!==publicMaterial(createPublicKey(ssa.claims.public_key_pem))||
    !SessionAssertionTrustBundleSchema.parse(json(input.publishedSsaFile)).keys.some(k=>canonicalSessionTrustJson(k)===canonicalSessionTrustJson(ssa)))throw Error("COMMERCIAL_SSA_TRUST_REJECTED");
  const sasRoot=root(p.sas.root_public_key_file,p.sas.root_spki_sha256),delivery=AuthorizationTrustDeliverySchema.parse(json(p.sas.trust_bundle_file));
  const bundle="transition" in delivery?delivery.bundle:delivery,b=bundle.claims;
  if(b.environment!==p.environment||b.issuer!==input.origin||b.authority_id!==p.sas.authority_id||canonicalSessionTrustJson(b.recipient)!==canonicalSessionTrustJson(d)||
    Date.parse(b.valid_from)>now||Date.parse(b.valid_until)<=now||!verify(null,unsignedAuthorizationTrustBytes(b),sasRoot,Buffer.from(bundle.signature,"base64url")))throw Error("COMMERCIAL_SAS_ROOT_TRUST_REJECTED");
  const sasKey=b.keys.find(k=>k.key_id===p.sas.key_id),sasPrivate=createPrivateKey(managed(p.sas.private_key_file,8192)),sasPublic=createPublicKey(sasPrivate);
  if(!sasKey||sasKey.status!=="ACTIVE"||sasPublic.asymmetricKeyType!=="ed25519"||publicMaterial(sasPublic)!==publicMaterial(createPublicKey(sasKey.public_key_pem)))throw Error("COMMERCIAL_SAS_KEY_REJECTED");
  const sasFrom=new Date(Math.max(Date.parse(sasKey.valid_from),Date.parse(b.valid_from))).toISOString(),sasUntil=new Date(Math.min(Date.parse(sasKey.valid_until),Date.parse(b.valid_until))).toISOString();
  if(Date.parse(sasFrom)>now||Date.parse(sasUntil)<=now)throw Error("COMMERCIAL_SAS_WINDOW_REJECTED");
  const accessPrivate=managed(p.access.private_key_file,8192).toString("utf8"),accessPublic=managed(p.access.public_key_file,8192).toString("utf8");
  if(new Set([publicMaterial(ssaPublic),publicMaterial(sasPublic),publicMaterial(createPublicKey(accessPublic))]).size!==3)throw Error("COMMERCIAL_SIGNING_PURPOSE_SEPARATION_REQUIRED");
  const rejection=managed(p.rejection_verifier_file,8192).toString("utf8").trim();if(!isSupportedPlatformPasswordVerifier(rejection))throw Error("COMMERCIAL_REJECTION_VERIFIER_REJECTED");
  const preflight=await input.pool.connect();
  try{
  await preflight.query("BEGIN READ ONLY");
  await preflight.query("SELECT set_config('app.tenant_id',$1,true)",[d.tenant_id]);
  const selected=await preflight.query(`SELECT 1 FROM identity.mfa_factors f JOIN identity.users u ON u.id=f.user_id AND u.status='ACTIVE'
    JOIN tenancy.tenant_memberships m ON m.user_id=u.id AND m.id=$2 AND m.tenant_id=$3 AND m.status='ACTIVE' AND m.suspended_at IS NULL AND m.revoked_at IS NULL
    JOIN identity.device_registry r ON r.device_id=$4 AND r.installation_id=$5 AND r.tenant_id=m.tenant_id AND r.company_id=$6 AND r.status='ACTIVE'
    JOIN organization.branches branch ON branch.id=$7 AND branch.tenant_id=m.tenant_id AND branch.company_id=r.company_id AND branch.status='ACTIVE'
    WHERE f.id=$1 AND f.factor_type='WEBAUTHN' AND f.status='ACTIVE' AND f.verified_at IS NOT NULL AND f.revoked_at IS NULL`,
    [p.factor_id,p.membership_id,d.tenant_id,d.device_id,d.installation_id,d.company_id,d.branch_id]);
  if(selected.rowCount!==1)throw Error("COMMERCIAL_AUTHENTIC_SCOPE_NOT_PROVISIONED");
  }finally{try{await preflight.query("ROLLBACK");}finally{preflight.release();}}
  if(Boolean(input.merchantDestinationsEnabled)!==Boolean(input.merchantQrSigning))throw Error("QR001_SIGNING_PROVISION_REQUIRED");
  if(input.merchantDestinationsEnabled){
    // Migration 024 must already exist in this EXACT Central database. Do not
    // enable an admin-facing endpoint on partially provisioned storage.
    const q=await input.pool.query<{ready:boolean}>(`SELECT
      to_regclass('payments.merchant_destinations') IS NOT NULL AND
      to_regclass('payments.merchant_qr_assets') IS NOT NULL AND
      to_regclass('payments.merchant_destination_outbox') IS NOT NULL AS ready`);
    if(q.rows[0]?.ready!==true)throw Error("QR001_CENTRAL_MIGRATION_024_REQUIRED");
  }
  const qrSigner=input.merchantQrSigning?createPrivateKey(managed(input.merchantQrSigning.keyPath,8192)):undefined;
  if(qrSigner && [publicMaterial(ssaPublic),publicMaterial(sasPublic),publicMaterial(createPublicKey(accessPublic))].includes(publicMaterial(createPublicKey(qrSigner))))
    throw Error("QR001_KEY_PURPOSE_NOT_SEPARATED");
  const qrPublisher=qrSigner&&input.merchantQrSigning?new CentralMerchantDestinationPublisher(input.pool,{
    purpose:"MERCHANT_DESTINATION_SNAPSHOT",environment:p.environment==="PRODUCTION"?"PRODUCTION":"STAGING",
    keyId:input.merchantQrSigning.keyId,privateKey:qrSigner,validFrom:input.merchantQrSigning.validFrom,
    validUntil:input.merchantQrSigning.validUntil,snapshotLifetimeMs:60*60*1000,
  }):undefined;
  const mfa=new BusinessInitialMfaFlow(input.pool,{rpId:p.rp_id,origin:input.origin,challengeLifetimeMs:l.mfa_challenge_ms,rejectionVerifier:rejection});
  const authority=new BusinessSessionAuthority(input.pool,mfa,{mode:"PRODUCTION",version:p.policy_reference,sessionLifetimeMs:l.session_ms,
    maximumMfaAgeMs:l.mfa_age_ms,maximumReauthenticationAgeMs:l.reauthentication_ms,accessProof:{mode:"COMMERCIAL_POSSESSION_V2",policyReference:p.policy_reference},
    abuse:{mode:"DURABLE_NATIVE_REQUEST_V2",policyReference:p.policy_reference}},deployment);
  const preparation=new BusinessAccessPreparation(input.pool,authority,{mode:"PRODUCTION",maximumContextAgeMs:l.context_age_ms,maximumReauthenticationAgeMs:l.reauthentication_ms},deployment);
  const audit=new PostgresPlatformSecurityEventRepository(input.pool),guard=new IsolatedBusinessAuditSessionGuard(input.pool,deployment);
  const coordinator=new IsolatedBusinessAuthCoordinator(preparation,input.pool,{authorityReference:"IDENTITY_SECURITY_EVENTS_COMMERCIAL_V2",record:async checked=>{
    await guard.whileActive(checked.identity,c=>audit.append({user_id:checked.identity.userId,session_id:checked.identity.sessionId,tenant_id:checked.identity.tenantId,
      event_code:PlatformSecurityEventCode.LOGIN_SUCCEEDED,result:"SUCCEEDED",reason_code:"COMMERCIAL_DEVICE_BINDING",correlation_id:uuidV7(),occurred_at:new Date().toISOString()},c));
  }});
  const families=new PostgresCommercialRefreshFamilies(input.pool,{origin:input.origin,audience:p.access.audience,clientId:p.registration.clientId,lifetimeMs:l.refresh_family_ms,
    maximumReauthenticationAgeMs:l.reauthentication_ms,maximumProofSkewMs:l.proof_skew_ms,rotationWindowMs:l.rotation_window_ms,maximumRotationsPerWindow:l.maximum_rotations});
  const access=new CommercialBusinessAccessAuthority(input.pool,{privatePem:accessPrivate,publicPem:accessPublic},{issuer:input.origin,audience:p.access.audience,
    clientId:p.registration.clientId,keyId:p.access.key_id,accessLifetimeMs:l.access_ms,maximumProofSkewMs:l.proof_skew_ms,signingValidFrom:p.access.valid_from,signingValidUntil:p.access.valid_until},families);
  const requests=new IsolatedNativeBusinessRequests(input.pool,{mode:"DEPLOYMENT",challengeLifetimeMs:l.native_challenge_ms,requestLifetimeMs:l.native_request_ms,
    codeLifetimeMs:l.native_code_ms,maximumChallengesPerMinute:l.maximum_challenges_per_minute,maximumReauthenticationAgeMs:l.reauthentication_ms},deployment);
  return prepareCommercialHttpHandler({pool:input.pool,tls:input.tls,origin:input.origin,mfa,authority,
    handoffs:new PostgresBrowserSessionHandoffWriter(input.origin,l.handoff_ms),browser:new DurableBrowserSessionStore(input.pool,input.origin,
      {mode:"CANONICAL",lifetimeMs:l.browser_ms,idleTimeoutMs:l.browser_idle_ms,maximumReauthenticationAgeMs:l.reauthentication_ms}),
    clients:new CommercialNativeClientCatalog([p.registration]),coordinator,pair:new IsolatedBusinessCredentialPairIssuer(input.pool,access,families,deployment),
    deploymentContext:deployment,nativeValidation:{requests,codec:access,signing:{mode:"DEPLOYMENT",environment:p.environment,operationalPrivateKey:ssaPrivate,rootTrustAnchor:ssaRoot,
      signedOperationalKey:ssa,policy:{maximumReauthenticationAgeMs:l.reauthentication_ms,maximumClaimAgeMs:l.ssa_claim_age_ms,maximumOfflineLifetimeMs:l.ssa_offline_ms}}},
    authorizationIssuer:new IsolatedAuthorizationSnapshotIssuer(input.pool,access,{tenantId:d.tenant_id,companyId:d.company_id,branchId:d.branch_id,installationId:d.installation_id,deviceId:d.device_id},
      {mode:"DEPLOYMENT",lifetimeMs:l.sas_ms,maximumReauthenticationAgeMs:l.reauthentication_ms},
      {mode:"DEPLOYMENT",environment:p.environment,purpose:"AUTHORIZATION_SNAPSHOT",keyId:p.sas.key_id,status:"ACTIVE",privateKey:sasPrivate,publicKey:sasPublic,validFrom:sasFrom,validUntil:sasUntil},
      {mode:"REGISTERED_015",lockTimeoutMs:l.sql_lock_timeout_ms},deployment),
    ...(input.merchantDestinationsEnabled?{merchantDestinations:new MerchantBusinessDestinationOperations(input.pool)}:{}),
    ...(qrPublisher?{merchantDeviceRoutes:new MerchantDestinationDeviceRoutes(input.pool,qrPublisher)}:{}),
    browserEntry:{rpId:p.rp_id,factorId:p.factor_id,tenantId:d.tenant_id,membershipId:p.membership_id,logoPng:managed(fileURLToPath(new URL("../../../docs/brand/camacho-pos-colombia-logo-960.png",import.meta.url)))},
    policy:{mode:"DEPLOYMENT",maximumBodyBytes:l.http_maximum_body_bytes,requestsPerMinute:l.http_requests_per_minute,maximumLoginAttempts:l.maximum_login_attempts,maximumBuckets:l.http_maximum_buckets}});
}
