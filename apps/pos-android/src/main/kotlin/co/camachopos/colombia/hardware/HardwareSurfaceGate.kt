package co.camachopos.colombia.hardware

/**
 * Block 4 gate over the existing `pos-local-service/native/android-hardware` AAR.
 * PRINT/DRAWER jobs require HardwareAuthorizationVerifier + signed jobs.
 * CH340 / TEK ATLAS scale uses the main profile doc; Camacho native SCALE adapter
 * is not claimed here. Drawer stays blocked without verified electrical profile.
 */
object HardwareSurfaceGate {
    const val PRINTER_CAPABILITY = "PRINT"
    const val DRAWER_CAPABILITY = "DRAWER"
    const val SCALE_PROFILE_DOC = "docs/hardware/android-m60wl-tek-atlas-ch340-scale.md"
    const val DRAWER_BLOCK_REASON = "M60WL_DRAWER_ELECTRICAL_PROFILE_UNVERIFIED"

    fun isCommercialHardwareReady(provisioned: Boolean, electricalProfileVerified: Boolean): Boolean =
        provisioned && electricalProfileVerified
}
