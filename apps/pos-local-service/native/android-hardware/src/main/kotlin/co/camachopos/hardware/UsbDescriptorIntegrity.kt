package co.camachopos.hardware

import java.security.MessageDigest

/** Stable USB descriptor fingerprint; independent of session or job authorization. */
object UsbDescriptorIntegrity {
    fun sha256(bytes: ByteArray): String =
        MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it.toInt() and 255) }
}
