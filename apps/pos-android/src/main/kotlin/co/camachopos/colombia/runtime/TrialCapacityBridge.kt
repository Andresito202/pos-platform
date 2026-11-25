package co.camachopos.colombia.runtime

import co.camachopos.colombia.security.OfflineExpiryPolicy

/**
 * Android observation of Central trial capacity (PR #135): exact 120h, zero
 * offline grace. Enforcement remains in Local Service LicenseCapacityGate once
 * signed capacity is provisioned. No mint/activate API here.
 */
object TrialCapacityBridge {
    const val SOURCE_PR = "pos-platform#135"
    const val TRIAL_HOURS = OfflineExpiryPolicy.TRIAL_DURATION_HOURS
    const val OFFLINE_GRACE_HOURS = OfflineExpiryPolicy.OFFLINE_GRACE_HOURS

    fun describeCapacityPolicy(): String =
        "Trial comercial: ${TRIAL_HOURS}h exactas · gracia offline ${OFFLINE_GRACE_HOURS}h · fuente $SOURCE_PR. " +
            "Requiere capacidad firmada Central + LicenseCapacityGate local; no se activa desde la UI."
}
