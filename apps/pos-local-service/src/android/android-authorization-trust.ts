import { lstatSync, readFileSync } from "node:fs";
import * as z from "zod";
import { canonicalSessionTrustJson } from "@pos-platform/contracts";
import type { EncryptedFileSecretStore } from "../security/encrypted-secret-store.js";
import { createHash, createPublicKey, verify } from "node:crypto";
import { SignedAuthorizationTrustSchema, unsignedAuthorizationTrustBytes, type AuthorizationTrustClaims } from "@pos-platform/contracts";
import type { TrustedSigningKey } from "../security/license-verifier.js";

/** Trust anchors are installed independently of the signed SAS bundle. */
export interface AndroidAuthorizationTrustPolicy {
  readonly rootPublicKeyPem: string;
  readonly rootSpkiSha256: string;
  readonly issuer: string;
  readonly authorityId: string;
  readonly environment: "PREPRODUCTION" | "PRODUCTION";
  readonly recipient: AuthorizationTrustClaims["recipient"];
}
export function verifyAndroidAuthorizationTrust(input: unknown, policy: AndroidAuthorizationTrustPolicy, now: Date) {
  const signed = SignedAuthorizationTrustSchema.parse(input);
  const c = signed.claims;
  const root = createPublicKey(policy.rootPublicKeyPem);
  const digest = createHash("sha256").update(root.export({type:"spki",format:"der"})).digest("hex");
  if (root.asymmetricKeyType !== "ed25519" || digest !== policy.rootSpkiSha256 ||
      !verify(null, unsignedAuthorizationTrustBytes(c), root, Buffer.from(signed.signature,"base64url"))) {
    throw Error("ANDROID_SAS_TRUST_SIGNATURE_REJECTED");
  }
  if (c.issuer !== policy.issuer || c.authority_id !== policy.authorityId || c.environment !== policy.environment ||
      c.recipient.tenant_id !== policy.recipient.tenant_id || c.recipient.company_id !== policy.recipient.company_id ||
      c.recipient.branch_id !== policy.recipient.branch_id || c.recipient.installation_id !== policy.recipient.installation_id ||
      c.recipient.device_id !== policy.recipient.device_id) throw Error("ANDROID_SAS_TRUST_BINDING_REJECTED");
  const at = now.getTime();
  if (!Number.isFinite(at) || at < Date.parse(c.valid_from) || at >= Date.parse(c.valid_until)) throw Error("ANDROID_SAS_TRUST_WINDOW_REJECTED");
  const keys = new Map<string, TrustedSigningKey>();
  for (const record of c.keys) {
    const key = createPublicKey(record.public_key_pem);
    if (key.asymmetricKeyType !== "ed25519") throw Error("ANDROID_SAS_KEY_TYPE_REJECTED");
    keys.set(record.key_id, {key,status:record.status,
      validFrom:new Date(Math.max(Date.parse(c.valid_from),Date.parse(record.valid_from))).toISOString(),
      validUntil:new Date(Math.min(Date.parse(c.valid_until),Date.parse(record.valid_until))).toISOString()});
  }
  return {signed,keys};
}

const ProvisionSchema = z.strictObject({
  profile:z.literal("CAMACHO_ANDROID_SAS_PROVISION_V1"),
  root_public_key_pem:z.string().min(80).max(4096),
  root_spki_sha256:z.string().regex(/^[a-f0-9]{64}$/),
  authority_id:z.string().min(1).max(96),
  bundle:SignedAuthorizationTrustSchema,
});
/** Installer-controlled root; protect accepted generations outside SQLite. */
export function resolveAndroidAuthorizationTrust(path:string, expected:Pick<AndroidAuthorizationTrustPolicy,"issuer"|"environment"|"recipient">, store:EncryptedFileSecretStore, now:Date) {
  if (store.protection !== "OS_BOUND") throw Error("ANDROID_SAS_OS_CUSTODY_REQUIRED");
  const stat=lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size>1024*1024) throw Error("ANDROID_SAS_PROVISION_REJECTED");
  const p=ProvisionSchema.parse(JSON.parse(readFileSync(path,"utf8")));
  const policy={...expected,rootPublicKeyPem:p.root_public_key_pem,rootSpkiSha256:p.root_spki_sha256,authorityId:p.authority_id};
  const candidate=verifyAndroidAuthorizationTrust(p.bundle,policy,now);
  const name="android-sas-trust";
  if(store.has(name)){
    const prior=z.strictObject({root:z.string(),bundle:SignedAuthorizationTrustSchema}).parse(JSON.parse(store.read(name).toString("utf8")));
    if(prior.root!==policy.rootSpkiSha256) throw Error("ANDROID_SAS_ROOT_CHANGE_REJECTED");
    if(candidate.signed.claims.generation<prior.bundle.claims.generation) throw Error("ANDROID_SAS_GENERATION_ROLLBACK");
    if(candidate.signed.claims.generation===prior.bundle.claims.generation &&
       canonicalSessionTrustJson(candidate.signed)!==canonicalSessionTrustJson(prior.bundle)) throw Error("ANDROID_SAS_GENERATION_CONFLICT");
  }
  store.write(name,Buffer.from(JSON.stringify({root:policy.rootSpkiSha256,bundle:candidate.signed})));
  return candidate.keys;
}
