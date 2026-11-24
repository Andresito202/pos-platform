package co.camachopos.colombia.hardware

/**
 * Gate over existing `pos-local-service/native/android-hardware` UsbHostTransport
 * and the documented CH340 M60WL lab profile. Does not certify physical pulse.
 */
object HardwareSurfaceGate {
    const val PRINTER_CAPABILITY = "PRINT"
    const val DRAWER_CAPABILITY = "DRAWER"
    const val SCALE_CAPABILITY = "SCALE"
    const val SCALE_PROFILE_DOC = "docs/hardware/android-m60wl-tek-atlas-ch340-scale.md"
    const val DRAWER_BLOCK_REASON = "M60WL_DRAWER_ELECTRICAL_PROFILE_UNVERIFIED"

    /** Observed CH340 family IDs from lab profile — not a unique TEK ATLAS proof. */
    const val CH340_VENDOR_ID = 6790
    const val CH340_PRODUCT_ID = 29987

    /** Gprinter GP-L80160 observed on M60WL lab evidence. */
    const val GPRINTER_VENDOR_ID = 26728
    const val GPRINTER_PRODUCT_ID = 1280

    fun classify(vendorId: Int, productId: Int): String = when {
        vendorId == CH340_VENDOR_ID && productId == CH340_PRODUCT_ID -> SCALE_CAPABILITY
        vendorId == GPRINTER_VENDOR_ID && productId == GPRINTER_PRODUCT_ID -> PRINTER_CAPABILITY
        else -> "UNKNOWN"
    }

    fun isCommercialHardwareReady(provisioned: Boolean, electricalProfileVerified: Boolean): Boolean =
        provisioned && electricalProfileVerified
}
