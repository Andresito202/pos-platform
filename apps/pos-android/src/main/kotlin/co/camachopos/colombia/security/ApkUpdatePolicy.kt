package co.camachopos.colombia.security

/**
 * Block 6 — APK update rules. Same signing certificate required for in-place
 * data retention (lab custody evidence). Sideload of a different signer must
 * not reuse commercial secrets. Play distribution is out of scope until approved.
 */
object ApkUpdatePolicy {
    const val REQUIRE_SAME_SIGNER_FOR_DATA_RETENTION = true
    const val PLAY_DISTRIBUTION = "NOT_CONFIGURED"

    fun mayRetainLocalCustody(previousSignerSha256: String?, nextSignerSha256: String?): Boolean {
        if (previousSignerSha256.isNullOrBlank() || nextSignerSha256.isNullOrBlank()) return false
        return previousSignerSha256 == nextSignerSha256
    }
}
