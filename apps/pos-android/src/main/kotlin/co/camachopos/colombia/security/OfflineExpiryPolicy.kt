package co.camachopos.colombia.security

/**
 * Block 6 — offline expiry policy aligned with Central trial (PR #135):
 * exact 120h window, zero offline grace, no fraudulent clock advancement.
 * Enforcement remains in Local Service `LicenseCapacityGate` / `TrustedClockGuard`
 * once capacity is accepted; this object only documents the Android host rules.
 */
object OfflineExpiryPolicy {
    const val TRIAL_DURATION_HOURS = 120
    const val OFFLINE_GRACE_HOURS = 0
    const val CLOCK_ROLLBACK_TOLERANCE = "REJECT"

    fun allowsCommercialSale(licenseStatus: String, trustedClockOk: Boolean): Boolean =
        trustedClockOk && licenseStatus == "CURRENT"
}
