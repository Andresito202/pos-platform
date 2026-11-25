/**
 * Android observation of Central trial capacity from PR #135.
 * Enforcement stays in LicenseCapacityGate once a signed provision is present.
 * This module does not mint, activate or extend licenses.
 */
export const ANDROID_TRIAL_CAPACITY_POLICY = Object.freeze({
  sourcePr: "pos-platform#135",
  trialHours: 120,
  offlineGraceHours: 0,
  gracePolicyReference: null,
  policyVersion: "TRIAL_120H_V1",
});

export function describeAndroidTrialCapacityPolicy(): string {
  return (
    `Trial comercial: ${ANDROID_TRIAL_CAPACITY_POLICY.trialHours}h exactas · ` +
    `gracia offline ${ANDROID_TRIAL_CAPACITY_POLICY.offlineGraceHours}h · ` +
    `fuente ${ANDROID_TRIAL_CAPACITY_POLICY.sourcePr}. ` +
    "Requiere capacidad firmada Central + LicenseCapacityGate local."
  );
}
