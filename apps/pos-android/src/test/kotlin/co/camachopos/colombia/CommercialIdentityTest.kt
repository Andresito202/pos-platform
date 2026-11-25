package co.camachopos.colombia

import co.camachopos.hardware.UsbDescriptorIntegrity

fun main() {
    check(CommercialIdentity.APPLICATION_ID == "co.camachopos.colombia")
    check(CommercialIdentity.MIN_SDK == 28)
    check(CommercialIdentity.TARGET_DEVICE_PROFILE == "M60WL_ANDROID_9")
    check(!CommercialIdentity.isLaboratoryPackage(CommercialIdentity.APPLICATION_ID))
    check(CommercialIdentity.isLaboratoryPackage("co.camachopos.android.runtimeprobe"))
    check(CommercialIdentity.isLaboratoryPackage("co.camachopos.android.probe"))
    check(CommercialIdentity.isLaboratoryPackage("co.example.lab"))
    check(UsbDescriptorIntegrity.sha256(byteArrayOf()) == "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855")
    check(UsbDescriptorIntegrity.sha256("abc".toByteArray(Charsets.UTF_8)) == "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")
    check(UsbDescriptorIntegrity.sha256(byteArrayOf(1, 2, 3)) != UsbDescriptorIntegrity.sha256(byteArrayOf(1, 2, 4)))
    println("COMMERCIAL_IDENTITY_AND_USB_INTEGRITY_PASS")
}
