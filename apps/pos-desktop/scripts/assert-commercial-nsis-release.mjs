/**
 * Commercial Windows release gate. No environment variable alone may attest
 * SERVICE/DESKTOP cross-session physical certification or Authenticode custody.
 * This stays closed until the repository has an audited, trusted release flow.
 */
export function assertCommercialNsisReleaseReady(env) {
  if (env.POS_NSIS_RELEASE_PROFILE !== "COMMERCIAL") {
    throw new Error("NSIS_COMMERCIAL_RELEASE_PROFILE_REQUIRED");
  }
  if (env.POS_NSIS_SERVICE_PROFILE !== "SCM_CANDIDATE") {
    throw new Error("NSIS_SCM_CANDIDATE_REQUIRED");
  }
  // Do not accept caller-controlled flags as proof of signing/provisioning.
  throw new Error("SCM_COMMERCIAL_CHANNEL_IDENTITY_INTEROP_NOT_PROVEN");
}
