/**
 * Reviewed SQL artifact lock for Windows preprod BUSINESS login stages.
 *
 * This manifest pins exact Git repository SQL contents on PR #99 as inspected
 * on 2026-10-29. 005 was ALSO independently verified on Windows. 006–016
 * hashes were recomputed from the Git blobs, NOT physically executed.
 * Updates to any artifact need explicit new review of SQL, dependencies,
 * RLS/ACL policies and receipt impact. No attempt to repair or apply DDL.
 */
export const PREPROD_BUSINESS_LOGIN_SQL_SHA256=Object.freeze({
  "005_onboarding_bootstrap_hardening":"4cc95c0fd293c75305c672d2b7b5e958d80a687fc5e0b736d5233272665f8387",
  "006_licensing_foundation":"0286a68e79f8952785765de71517b551c0962445142e1be1cfc5bed88bacc246",
  "007_password_recovery":"0b8f2905139cfc2e730b91bd029b20886b17109686aa5b0a5c6adb822beed4b7",
  "008_platform_role_assignments":"92a08945f36ab4478149402629598e18346bd01cc73b7124307d8c1f97b955d7",
  "009_webauthn_challenges":"7ae7aacf0b244f383afcd16db35e6177b86e232a7b23314183d5b06014b71f73",
  "010_webauthn_credential_material":"116c20f91e1d6cb31e68a16b5537bdd67983b0792f5014fdd5e363de16646b52",
  "011_session_assertion_sequences":"8d682015c220e4be150a08e800fd194a04834044ec45956969a23079dd5215f2",
  "012_device_request_proof_replays":"8c7b362288201d4da32792785927c39938e67065119cd6e7b66012191f46a2d8",
  "013_business_browser_sessions":"f8d94295f1d090d8be946ddfb231ebcabdabe07d06f776727c3518e99b3416c8",
  "014_commercial_refresh_binding":"7854af3d2775c5ec9f14c15b9549228c1ed69d530ecbb7021e76303d901951d4",
  "015_authorization_snapshot_sequences":"5b17aff65217fdca8ef9481dad3b014d5219718eabf1ec2d527c5bc0b7e2b9e3",
  "016_native_business_authorization":"5acb7d3db199b1b922f9748882720d37207e7599e4ac6d67d49e1ce34b6a016e",
} as const);

type MigrationName=keyof typeof PREPROD_BUSINESS_LOGIN_SQL_SHA256;

export function assertPinnedPreprodLoginArtifact(id:string,hash:string):void{
  const expected=PREPROD_BUSINESS_LOGIN_SQL_SHA256[id as MigrationName];
  if(!expected||hash!==expected)
    throw Error("LOGIN_SQL_PINNED_ARTIFACT_CHANGED_STOP");
}

export function verifyPreprodLoginArtifactLock(
  artifacts:readonly {id:string;hash:string}[]
):void{
  const canonical=Object.keys(PREPROD_BUSINESS_LOGIN_SQL_SHA256) as MigrationName[];
  if(artifacts.length!==canonical.length ||
     canonical.some((name,index)=>artifacts[index]?.id!==name))
    throw Error("LOGIN_SQL_PINNED_CANONICAL_ORDER_DRIFT");
  for(const artifact of artifacts)
    assertPinnedPreprodLoginArtifact(artifact.id,artifact.hash);
}
