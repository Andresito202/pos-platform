package co.camachopos.colombia.security

/**
 * Block 6 — multi-company isolation on device. Binding IDs come from trusted
 * provisioning, never from UI fields. Crossing tenant/company without a new
 * enrollment is rejected.
 */
object TenantIsolationGuard {
    data class Binding(val tenantId: String, val companyId: String, val installationId: String, val deviceId: String)

    fun accepts(active: Binding?, candidate: Binding): Boolean {
        if (active == null) return false
        return active == candidate
    }
}
