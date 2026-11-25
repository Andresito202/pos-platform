package co.camachopos.colombia

fun main() {
    check(CommercialIdentity.APPLICATION_ID == "co.camachopos.colombia")
    check(CommercialIdentity.MIN_SDK == 28)
    check(CommercialIdentity.TARGET_DEVICE_PROFILE == "M60WL_ANDROID_9")
    check(!CommercialIdentity.isLaboratoryPackage(CommercialIdentity.APPLICATION_ID))
    check(CommercialIdentity.isLaboratoryPackage("co.camachopos.android.runtimeprobe"))
    check(CommercialIdentity.isLaboratoryPackage("co.camachopos.android.probe"))
    check(CommercialIdentity.isLaboratoryPackage("co.example.lab"))
    println("COMMERCIAL_IDENTITY_PASS")
}
