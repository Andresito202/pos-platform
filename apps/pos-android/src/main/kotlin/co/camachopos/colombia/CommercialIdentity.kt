package co.camachopos.colombia

/** Stable commercial application identity. Laboratory probe packages are rejected
 * by Central association preparation and must never be aliased to this id. */
object CommercialIdentity {
    const val APPLICATION_ID = "co.camachopos.colombia"
    const val DISPLAY_NAME = "Camacho POS Colombia"
    const val MIN_SDK = 28
    const val TARGET_DEVICE_PROFILE = "M60WL_ANDROID_9"

    fun isLaboratoryPackage(packageId: String): Boolean =
        Regex("""(?:^|\.)(?:runtimeprobe|probe|lab|debug)$""").containsMatchIn(packageId)
}
