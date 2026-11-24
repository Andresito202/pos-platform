package co.camachopos.colombia.runtime

/**
 * Block 5 placeholder for binding Android license observation to Central trial
 * capacity (PR #135 commercial portal bridge: 120h exact, no offline grace).
 *
 * This type intentionally exposes no activate/mint API. Calling code must use
 * Local Service `LicenseCapacityGate` + trusted provisioning; UI must not treat
 * presence of this class as an active trial.
 */
object TrialCapacityBridge {
    const val SOURCE_PR = "pos-platform#135"
    const val TRIAL_HOURS = 120
    const val OFFLINE_GRACE_HOURS = 0

    fun describesUnwiredCapacity(): String =
        "Trial/licencia Android no cableada: requiere enrolamiento, capacidad firmada Central y gate local. Fuente de trial 120h: $SOURCE_PR."
}
